# keyboard.ps1 - 键盘模拟脚本
# 支持: press(快捷键), down(按下), up(释放), paste(Ctrl+V), pasteEnter, enter(回车), click, doubleClick
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
        public INPUTUNION U;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    public static uint SendKeyboard(ushort vk, ushort scan, uint flags) {
        INPUT input = new INPUT();
        input.type = 1;
        input.U.ki.wVk = vk;
        input.U.ki.wScan = scan;
        input.U.ki.dwFlags = flags;
        input.U.ki.time = 0;
        input.U.ki.dwExtraInfo = IntPtr.Zero;
        return SendInput(1, new INPUT[] { input }, Marshal.SizeOf(typeof(INPUT)));
    }

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

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
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
$SW_RESTORE            = 9

function Test-TargetWindow {
    param([IntPtr]$hWnd, [uint32]$ownerProcessId)

    if ($hWnd -eq [IntPtr]::Zero) { return $false }
    if (-not [InputNative]::IsWindowVisible($hWnd)) { return $false }
    if ([InputNative]::GetWindowTextLength($hWnd) -le 0) { return $false }
    $exStyle = [InputNative]::GetWindowLong($hWnd, $GWL_EXSTYLE)
    if (($exStyle -band $WS_EX_TOOLWINDOW) -ne 0) { return $false }

    [uint32]$candidateProcessId = 0
    [void][InputNative]::GetWindowThreadProcessId($hWnd, [ref]$candidateProcessId)
    if ($ownerProcessId -gt 0 -and $candidateProcessId -eq $ownerProcessId) { return $false }
    return $true
}

function Test-ExternalForegroundWindow {
    param([IntPtr]$hWnd, [uint32]$ownerProcessId)

    if ($hWnd -eq [IntPtr]::Zero) { return $false }
    if (-not [InputNative]::IsWindowVisible($hWnd)) { return $false }

    [uint32]$candidateProcessId = 0
    [void][InputNative]::GetWindowThreadProcessId($hWnd, [ref]$candidateProcessId)
    if ($candidateProcessId -eq 0) { return $false }
    if ($ownerProcessId -gt 0 -and $candidateProcessId -eq $ownerProcessId) { return $false }
    return $true
}

function Activate-TargetWindow {
    param([IntPtr]$hWnd)

    [uint32]$targetProcessId = 0
    $targetThreadId = [InputNative]::GetWindowThreadProcessId($hWnd, [ref]$targetProcessId)
    $currentThreadId = [InputNative]::GetCurrentThreadId()
    $attached = $false
    if ($targetThreadId -gt 0 -and $targetThreadId -ne $currentThreadId) {
        $attached = [InputNative]::AttachThreadInput($currentThreadId, $targetThreadId, $true)
    }
    try {
        [InputNative]::ShowWindow($hWnd, $SW_RESTORE) | Out-Null
        [InputNative]::BringWindowToTop($hWnd) | Out-Null
        [InputNative]::SetForegroundWindow($hWnd) | Out-Null
    } finally {
        if ($attached) {
            [InputNative]::AttachThreadInput($currentThreadId, $targetThreadId, $false) | Out-Null
        }
    }
    Start-Sleep -Milliseconds 100
}

# ── 焦点还原：找到并激活真正的目标窗口 ──────────────────────────────────────
# 当用户点击 Electron 按钮后，焦点可能被夺走到 Electron 或者桌面。
# 本函数沿 Z 序向下查找第一个可见、有标题、非工具窗口的普通窗口并激活它。
function Restore-TargetFocus {
    param([long]$skipHwnd)

    [IntPtr]$fg = [InputNative]::GetForegroundWindow()
    $fgVal = $fg.ToInt64()

    [uint32]$ownerProcessId = 0
    [IntPtr]$owner = [IntPtr]::Zero
    if ($skipHwnd -gt 0) { $owner = [IntPtr]$skipHwnd }
    if ($owner -ne [IntPtr]::Zero) {
        [void][InputNative]::GetWindowThreadProcessId($owner, [ref]$ownerProcessId)
    }

    # 主工具窗口设置为不抢焦点，因此正常情况下当前前台窗口就是用户的
    # 输入目标。这里不再用“必须有标题”等条件误伤浏览器输入框或无标题窗口。
    $foregroundIsExternal = Test-ExternalForegroundWindow -hWnd $fg -ownerProcessId $ownerProcessId
    if (($fgVal -ne $skipHwnd) -and $foregroundIsExternal) {
        Write-Output "focus=foreground hwnd=$fgVal"
        return
    }

    # 从 Electron 自身窗口开始沿 Z 序向下找，避免把桌面误判为输入目标。
    [IntPtr]$cur = $fg
    if ($owner -ne [IntPtr]::Zero) { $cur = $owner }
    for ($i = 0; $i -lt 200; $i++) {
        [IntPtr]$next = [InputNative]::GetWindow($cur, $GW_HWNDNEXT)
        if ($next -eq [IntPtr]::Zero) { break }

        $hval = $next.ToInt64()
        # 跳过 Electron 自身窗口及同进程的其他悬浮窗口
        if ($skipHwnd -gt 0 -and $hval -eq $skipHwnd) { $cur = $next; continue }
        $isTarget = Test-TargetWindow -hWnd $next -ownerProcessId $ownerProcessId
        if (-not $isTarget) { $cur = $next; continue }

        # 找到目标，激活它
        Activate-TargetWindow -hWnd $next
        Write-Output "focus=restored hwnd=$hval"
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
    $flags = 0                      # 标准 VK 模式，不使用纯扫描码
    if ($key.Extended) { $flags = $flags -bor $KEYEVENTF_EXTENDEDKEY }
    if ($isUp)         { $flags = $flags -bor $KEYEVENTF_KEYUP }
    $sent = [InputNative]::SendKeyboard([uint16]$key.Vk, [uint16]$key.Scan, [uint32]$flags)
    if ($sent -ne 1) {
        throw "SendInput failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
}

switch ($action) {
    'press' {
        # 工具窗口本身不抢焦点，直接把按键发送给用户当前输入窗口。
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
        Start-Sleep -Milliseconds 80
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { SendKey $codes[$i] $true }
    }
    'down' {
        # 长按同样沿用当前输入焦点。
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
    }
    'up' {
        # 释放：焦点此时应已在目标窗口，直接发
        $codes = ParseKeys $keys
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { SendKey $codes[$i] $true }
    }
    'paste' {
        $shell = New-Object -ComObject WScript.Shell
        $shell.SendKeys('^v')
    }
    'pasteEnter' {
        $shell = New-Object -ComObject WScript.Shell
        $shell.SendKeys('^v')
        Start-Sleep -Milliseconds 100
        $shell.SendKeys('{ENTER}')
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
        $shell = New-Object -ComObject WScript.Shell
        $shell.SendKeys('{ENTER}')
    }
}
