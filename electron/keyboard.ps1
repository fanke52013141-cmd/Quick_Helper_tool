# keyboard.ps1 - 键盘模拟脚本
# 支持: press(快捷键), down(按下), up(释放), paste(Ctrl+V), enter(回车)
param(
    [Parameter(Mandatory=$true)][string]$action,
    [string]$keys = ""
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class KB {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, IntPtr dwExtraInfo);
    [DllImport("user32.dll")]
    public static extern void SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, IntPtr dwExtraInfo);
}
"@

$KeyMap = @{}
$KeyMap['ctrl'] = 0x11; $KeyMap['control'] = 0x11
$KeyMap['shift'] = 0x10; $KeyMap['alt'] = 0x12; $KeyMap['win'] = 0x5B
$KeyMap['enter'] = 0x0D; $KeyMap['return'] = 0x0D
$KeyMap['tab'] = 0x09; $KeyMap['esc'] = 0x1B; $KeyMap['escape'] = 0x1B
$KeyMap['space'] = 0x20; $KeyMap[' '] = 0x20; $KeyMap['backspace'] = 0x08
$KeyMap['delete'] = 0x2E; $KeyMap['del'] = 0x2E
$KeyMap['insert'] = 0x2D; $KeyMap['home'] = 0x24; $KeyMap['end'] = 0x23
$KeyMap['pageup'] = 0x21; $KeyMap['pagedown'] = 0x22
$KeyMap['up'] = 0x26; $KeyMap['arrowup'] = 0x26; $KeyMap['down'] = 0x28; $KeyMap['arrowdown'] = 0x28
$KeyMap['left'] = 0x25; $KeyMap['arrowleft'] = 0x25; $KeyMap['right'] = 0x27; $KeyMap['arrowright'] = 0x27
$KeyMap['capslock'] = 0x14
$KeyMap['plus'] = 0xBB; $KeyMap['='] = 0xBB
$KeyMap['minus'] = 0xBD; $KeyMap['-'] = 0xBD
$KeyMap['comma'] = 0xBC; $KeyMap[','] = 0xBC
$KeyMap['period'] = 0xBE; $KeyMap['.'] = 0xBE
$KeyMap['slash'] = 0xBF; $KeyMap['/'] = 0xBF
$KeyMap['backquote'] = 0xC0; $KeyMap['`'] = 0xC0
$KeyMap['semicolon'] = 0xBA; $KeyMap[';'] = 0xBA
$KeyMap['quote'] = 0xDE; $KeyMap["'"] = 0xDE
$KeyMap['bracketleft'] = 0xDB; $KeyMap['['] = 0xDB
$KeyMap['bracketright'] = 0xDD; $KeyMap[']'] = 0xDD
$KeyMap['backslash'] = 0xDC; $KeyMap['\'] = 0xDC
for ($i = 65; $i -le 90; $i++) { $KeyMap[([string][char]$i).ToLower()] = $i }
for ($i = 48; $i -le 57; $i++) { $KeyMap[[char]$i -as [string]] = $i }
for ($i = 1; $i -le 24; $i++) { $KeyMap["f$i"] = 0x6F + $i }

$KEYDOWN = 0
$KEYUP = 0x0002
$MOUSEEVENTF_LEFTDOWN = 0x0002
$MOUSEEVENTF_LEFTUP = 0x0004

function GetVk($key) {
    $k = $key.ToLower().Trim()
    if ($KeyMap.ContainsKey($k)) { return [byte]$KeyMap[$k] }
    return -1
}

function ParseKeys($keys) {
    $text = $keys.Trim()
    if ($text -eq '+') { return @([byte]$KeyMap['plus']) }
    $parts = $text -split '\+'
    $codes = @()
    foreach ($p in $parts) {
        $code = GetVk $p
        if ($code -ge 0) { $codes += $code }
    }
    return $codes
}

switch ($action) {
    'press' {
        $codes = ParseKeys $keys
        foreach ($c in $codes) { [KB]::keybd_event($c, 0, $KEYDOWN, [IntPtr]::Zero) }
        Start-Sleep -Milliseconds 30
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { [KB]::keybd_event($codes[$i], 0, $KEYUP, [IntPtr]::Zero) }
    }
    'down' {
        $codes = ParseKeys $keys
        foreach ($c in $codes) { [KB]::keybd_event($c, 0, $KEYDOWN, [IntPtr]::Zero) }
    }
    'up' {
        $codes = ParseKeys $keys
        for ($i = $codes.Length - 1; $i -ge 0; $i--) { [KB]::keybd_event($codes[$i], 0, $KEYUP, [IntPtr]::Zero) }
    }
    'paste' {
        [KB]::keybd_event(0x11, 0, $KEYDOWN, [IntPtr]::Zero)
        [KB]::keybd_event(0x56, 0, $KEYDOWN, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [KB]::keybd_event(0x56, 0, $KEYUP, [IntPtr]::Zero)
        [KB]::keybd_event(0x11, 0, $KEYUP, [IntPtr]::Zero)
    }
    'click' {
        [KB]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [KB]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    }
    'doubleClick' {
        [KB]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [KB]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 80
        [KB]::mouse_event($MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 30
        [KB]::mouse_event($MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    }
    'enter' {
        [KB]::keybd_event(0x0D, 0, $KEYDOWN, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 20
        [KB]::keybd_event(0x0D, 0, $KEYUP, [IntPtr]::Zero)
    }
}
