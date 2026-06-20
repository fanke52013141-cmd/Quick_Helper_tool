# keyboard.ps1 - 键盘模拟脚本
# 支持: press(快捷键), down(按下), up(释放), paste(Ctrl+V), enter(回车), click, doubleClick
param(
    [Parameter(Mandatory=$true)][string]$action,
    [string]$keys = "",
    [long]$ownerHwnd = 0    # Electron 窗口自身的 HWND，用于焦点还原时跳过它
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class InputNative {
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern uint MapVirtualKey(uint uCode, uint uMapType);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);

    // --- 焦点还原所需 Win32 API ---
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowLong(IntPtr hWnd, int nIndex);
}
"@

$INPUT_KEYBOARD      = 1
$KEYEVENTF_EXTENDEDKEY = 0x0001
$KEYEVENTF_KEYUP       = 0x0002
$MOUSEEVENTF_LEFTDOWN  = 0x0002
$MOUSEEVENTF_LEFTUP    = 0x0004
$GW_HWNDNEXT           = 2
$GWL_EXSTYLE           = -20
$WS_EX_TOOLWINDOW      = 0x00000080

# ── 焦点还原：找到并激活真正的目标窗口 ──────────────────────────────────────
# 当用户点击 Electron 按钮后，焦点可能被夺走到 Electron 或者桌面。
# 本函数沿 Z 序向下查找第一个可见、有标题、非工具窗口的普通窗口并激活它。
function Restore-TargetFocus {
    param([long]$skipHwnd)

    $fg = [InputNative]::GetForegroundWindow()
    $fgVal = $fg.ToInt64()

    # 如果当前前台不是 Electron 窗口，说明焦点已在目标应用，直接返回
    if ($skipHwnd -gt 0 -and $fgVal -ne $skipHwnd) { return }

    # 沿 Z 序往下找第一个合适的普通窗口
    $cur = $fg
    for ($i = 0; $i -lt 200; $i++) {
        $next = [InputNative]::GetWindow($cur, $GW_HWNDNEXT)
        if ($next -eq [IntPtr]::Zero) { break }

        $hval = $next.ToInt64()
        # 跳过 Electron 自身窗口
        if ($skipHwnd -gt 0 -and $hval -eq $skipHwnd) { $cur = $next; continue }
        # 跳过不可见窗口
        if (-not [InputNative]::IsWindowVisible($next)) { $cur = $next; continue }
        # 跳过无标题窗口（任务栏、系统托盘等）
        if ([InputNative]::GetWindowTextLength($next) -le 0) { $cur = $next; continue }
        # 跳过工具窗口（WS_EX_TOOLWINDOW）
        $exStyle = [InputNative]::GetWindowLong($next, $GWL_EXSTYLE)
        if (($exStyle -band $WS_EX_TOOLWINDOW) -ne 0) { $cur = $next; continue }

        # 找到目标，激活它
        [InputNative]::SetForegroundWindow($next) | Out-Null
        Start-Sleep -Milliseconds 80   # 等待焦点真正切换完成
        break
    }
}

function New-Key($vk, $scan = $null, $extended = $false) {
    if ($null -eq $scan) { $scan = [InputNative]::MapVirtualKey([uint32]$vk, 0) }
    return [PSCustomObject]@{ Vk = [uint16]$vk; Scan = [uint16]$scan; Extended = [bool]$extended }
}

$KeyMap = @{}
$KeyMap['ctrl']        = New-Key 0x11 0x1D $false
$KeyMap['control']     = $KeyMap['ctrl']
$KeyMap['leftctrl']    = $KeyMap['ctrl']
$KeyMap['rightctrl']   = New-Key 0xA3 0x1D $true
$KeyMap['shift']       = New-Key 0x10 0x2A $false
$KeyMap['leftshift']   = $KeyMap['shift']
$KeyMap['rightshift']  = New-Key 0xA1 0x36 $false
$KeyMap['alt']         = New-Key 0x12 0x38 $false
$KeyMap['leftalt']     = $KeyMap['alt']
$KeyMap['rightalt']    = New-Key 0xA5 0x38 $true
$KeyMap['win']         = New-Key 0x5B 0x5B $true
$KeyMap['leftwin']     = $KeyMap['win']
$KeyMap['rightwin']    = New-Key 0x5C 0x5C $true
$KeyMap['meta']        = $KeyMap['win']
$KeyMap['enter']       = New-Key 0x0D
$KeyMap['return']      = $KeyMap['enter']
$KeyMap['tab']         = New-Key 0x09
$KeyMap['esc']         = New-Key 0x1B
$KeyMap['escape']      = $KeyMap['esc']
$KeyMap['space']       = New-Key 0x20
$KeyMap[' ']           = $KeyMap['space']
$KeyMap['backspace']   = New-Key 0x08
$KeyMap['delete']      = New-Key 0x2E 0x53 $true
$KeyMap['del']         = $KeyMap['delete']
$KeyMap['insert']      = New-Key 0x2D 0x52 $true
$KeyMap['home']        = New-Key 0x24 0x47 $true
$KeyMap['end']         = New-Key 0x23 0x4F $true
$KeyMap['pageup']      = New-Key 0x21 0x49 $true
$KeyMap['pagedown']    = New-Key 0x22 0x51 $true
$KeyMap['up']          = New-Key 0x26 0x48 $true
$KeyMap['arrowup']     = $KeyMap['up']
$KeyMap['down']        = New-Key 0x28 0x50 $true
$KeyMap['arrowdown']   = $KeyMap['down']
$KeyMap['left']        = New-Key 0x25 0x4B $true
$KeyMap['arrowleft']   = $KeyMap['left']
$KeyMap['right']       = New-Key 0x27 0x4D $true
$KeyMap['arrowright']  = $KeyMap['right']
$KeyMap['capslock']    = New-Key 0x14
$KeyMap['plus']        = New-Key 0xBB
$KeyMap['=']           = $KeyMap['plus']
$KeyMap['minus']       = New-Key 0xBD
$KeyMap['-']           = $KeyMap['minus']
$KeyMap['comma']       = New-Key 0xBC
$KeyMap[',']           = $KeyMap['comma']
$KeyMap['period']      = New-Key 0xBE
$KeyMap['.']           = $KeyMap['period']
$KeyMap['slash']       = New-Key 0xBF
$KeyMap['/']           = $KeyMap['slash']
$KeyMap['backquote']   = New-Key 0xC0
$KeyMap['`']           = $KeyMap['backquote']
$KeyMap['semicolon']   = New-Key 0xBA
$KeyMap[';']           = $KeyMap['semicolon']
$KeyMap['quote']       = New-Key 0xDE
$KeyMap["'"]           = $KeyMap['quote']
$KeyMap['bracketleft'] = New-Key 0xDB
$KeyMap['[']           = $KeyMap['bracketleft']
$KeyMap['bracketright']= New-Key 0xDD
$KeyMap[']']           = $KeyMap['bracketright']
$KeyMap['backslash']   = New-Key 0xDC
$KeyMap['\']           = $KeyMap['backslash']

for ($i = 65; $i -le 90; $i++) { $KeyMap[([string][char]$i).ToLower()] = New-Key $i }
for ($i = 48; $i -le 57; $i++) { $KeyMap[[char]$i -as [string]] = New-Key $i }
for ($i = 1; $i -le 24; $i++) { $KeyMap["f$i"] = New-Key (0x6F + $i) }

function GetKey($key) {
    $k = $key.ToLower().Trim()
    if ($KeyMap.ContainsKey($k)) { return $KeyMap[$k] }
    return $null
}

function ParseKeys($keys) {
    $text = $keys.Trim()
    if ($text -eq '+') { return @($KeyMap['plus']) }
    $parts = $text -split '\+'
    $result = @()
    foreach ($p in $parts) {
        $key = GetKey $p
        if ($null -ne $key) { $result += $key }
    }
    return $result
}

function SendKey($key, $isUp) {
    $input = New-Object InputNative+INPUT
    $input.type = $INPUT_KEYBOARD
    $input.ki.wVk   = $key.Vk      # 使用 VK 码，确保修饰键在所有应用中都能生效
    $input.ki.wScan = $key.Scan
    $flags = 0                      # 标准 VK 模式，不使用纯扫描码
    if ($key.Extended) { $flags = $flags -bor $KEYEVENTF_EXTENDEDKEY }
    if ($isUp)         { $flags = $flags -bor $KEYEVENTF_KEYUP }
    $input.ki.dwFlags      = $flags
    $input.ki.time         = 0
    $input.ki.dwExtraInfo  = [IntPtr]::Zero
    [InputNative]::SendInput(1, @($input), [Runtime.InteropServices.Marshal]::SizeOf([type][InputNative+INPUT])) | Out-Null
}

switch ($action) {
    'press' {
        # ① 先把焦点还给目标窗口，再发按键
        Restore-TargetFocus -skipHwnd $ownerHwnd
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
        Start-Sleep -Milliseconds 80
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { SendKey $codes[$i] $true }
    }
    'down' {
        # 长按：同样先还焦点
        Restore-TargetFocus -skipHwnd $ownerHwnd
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
    }
    'up' {
        # 释放：焦点此时应已在目标窗口，直接发
        $codes = ParseKeys $keys
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { SendKey $codes[$i] $true }
    }
    'paste' {
        SendKey $KeyMap['ctrl'] $false
        SendKey $KeyMap['v'] $false
        Start-Sleep -Milliseconds 50
        SendKey $KeyMap['v'] $true
        SendKey $KeyMap['ctrl'] $true
    }
    'click' {
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    }
    'doubleClick' {
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 80
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [InputNative]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    }
    'enter' {
        SendKey $KeyMap['enter'] $false
        Start-Sleep -Milliseconds 30
        SendKey $KeyMap['enter'] $true
    }
}
