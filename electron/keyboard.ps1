# keyboard.ps1 - 键盘模拟脚本
# 支持: press(快捷键), down(按下), up(释放), paste(Ctrl+V), enter(回车), click, doubleClick
param(
    [Parameter(Mandatory=$true)][string]$action,
    [string]$keys = ""
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

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
}
"@

$INPUT_KEYBOARD = 1
$KEYEVENTF_EXTENDEDKEY = 0x0001
$KEYEVENTF_KEYUP = 0x0002
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function New-Key($vk, $scan = $null, $extended = $false) {
    if ($null -eq $scan) { $scan = [InputNative]::MapVirtualKey([uint32]$vk, 0) }
    return [PSCustomObject]@{ Vk = [uint16]$vk; Scan = [uint16]$scan; Extended = [bool]$extended }
}

$KeyMap = @{}
$KeyMap['ctrl'] = New-Key 0x11 0x1D $false
$KeyMap['control'] = $KeyMap['ctrl']
$KeyMap['leftctrl'] = $KeyMap['ctrl']
$KeyMap['rightctrl'] = New-Key 0xA3 0x1D $true
$KeyMap['shift'] = New-Key 0x10 0x2A $false
$KeyMap['leftshift'] = $KeyMap['shift']
$KeyMap['rightshift'] = New-Key 0xA1 0x36 $false
$KeyMap['alt'] = New-Key 0x12 0x38 $false
$KeyMap['leftalt'] = $KeyMap['alt']
$KeyMap['rightalt'] = New-Key 0xA5 0x38 $true
$KeyMap['win'] = New-Key 0x5B 0x5B $true
$KeyMap['leftwin'] = $KeyMap['win']
$KeyMap['rightwin'] = New-Key 0x5C 0x5C $true
$KeyMap['meta'] = $KeyMap['win']
$KeyMap['enter'] = New-Key 0x0D
$KeyMap['return'] = $KeyMap['enter']
$KeyMap['tab'] = New-Key 0x09
$KeyMap['esc'] = New-Key 0x1B
$KeyMap['escape'] = $KeyMap['esc']
$KeyMap['space'] = New-Key 0x20
$KeyMap[' '] = $KeyMap['space']
$KeyMap['backspace'] = New-Key 0x08
$KeyMap['delete'] = New-Key 0x2E 0x53 $true
$KeyMap['del'] = $KeyMap['delete']
$KeyMap['insert'] = New-Key 0x2D 0x52 $true
$KeyMap['home'] = New-Key 0x24 0x47 $true
$KeyMap['end'] = New-Key 0x23 0x4F $true
$KeyMap['pageup'] = New-Key 0x21 0x49 $true
$KeyMap['pagedown'] = New-Key 0x22 0x51 $true
$KeyMap['up'] = New-Key 0x26 0x48 $true
$KeyMap['arrowup'] = $KeyMap['up']
$KeyMap['down'] = New-Key 0x28 0x50 $true
$KeyMap['arrowdown'] = $KeyMap['down']
$KeyMap['left'] = New-Key 0x25 0x4B $true
$KeyMap['arrowleft'] = $KeyMap['left']
$KeyMap['right'] = New-Key 0x27 0x4D $true
$KeyMap['arrowright'] = $KeyMap['right']
$KeyMap['capslock'] = New-Key 0x14
$KeyMap['plus'] = New-Key 0xBB
$KeyMap['='] = $KeyMap['plus']
$KeyMap['minus'] = New-Key 0xBD
$KeyMap['-'] = $KeyMap['minus']
$KeyMap['comma'] = New-Key 0xBC
$KeyMap[','] = $KeyMap['comma']
$KeyMap['period'] = New-Key 0xBE
$KeyMap['.'] = $KeyMap['period']
$KeyMap['slash'] = New-Key 0xBF
$KeyMap['/'] = $KeyMap['slash']
$KeyMap['backquote'] = New-Key 0xC0
$KeyMap['`'] = $KeyMap['backquote']
$KeyMap['semicolon'] = New-Key 0xBA
$KeyMap[';'] = $KeyMap['semicolon']
$KeyMap['quote'] = New-Key 0xDE
$KeyMap["'"] = $KeyMap['quote']
$KeyMap['bracketleft'] = New-Key 0xDB
$KeyMap['['] = $KeyMap['bracketleft']
$KeyMap['bracketright'] = New-Key 0xDD
$KeyMap[']'] = $KeyMap['bracketright']
$KeyMap['backslash'] = New-Key 0xDC
$KeyMap['\'] = $KeyMap['backslash']

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
    $input.ki.wVk = $key.Vk      # 使用 VK 码，确保修饰键在所有应用中都能生效
    $input.ki.wScan = $key.Scan
    $flags = 0                    # 不再使用 KEYEVENTF_SCANCODE，改为标准 VK 模式
    if ($key.Extended) { $flags = $flags -bor $KEYEVENTF_EXTENDEDKEY }
    if ($isUp) { $flags = $flags -bor $KEYEVENTF_KEYUP }
    $input.ki.dwFlags = $flags
    $input.ki.time = 0
    $input.ki.dwExtraInfo = [IntPtr]::Zero
    [InputNative]::SendInput(1, @($input), [Runtime.InteropServices.Marshal]::SizeOf([type][InputNative+INPUT])) | Out-Null
}

switch ($action) {
    'press' {
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
        Start-Sleep -Milliseconds 80
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { SendKey $codes[$i] $true }
    }
    'down' {
        $codes = ParseKeys $keys
        foreach ($c in $codes) { SendKey $c $false }
    }
    'up' {
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
