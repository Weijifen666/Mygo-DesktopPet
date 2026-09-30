$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$signature = @'
[DllImport("user32.dll")]
public static extern IntPtr GetForegroundWindow();

[DllImport("user32.dll")]
public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
'@

Add-Type -MemberDefinition $signature -Name ForegroundWindow -Namespace MyGo

while ($true) {
  $handle = [MyGo.ForegroundWindow]::GetForegroundWindow()
  [uint32]$processId = 0
  [void][MyGo.ForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
  $application = (Get-Process -Id $processId).ProcessName
  if ($application) {
    [Console]::Out.WriteLine($application)
    [Console]::Out.Flush()
  }
  Start-Sleep -Seconds 15
}
