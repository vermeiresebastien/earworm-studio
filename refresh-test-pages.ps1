# Regenerates the test/screenshot pages from index.html.
# Uses explicit UTF-8 on both read and write so characters like the middle dot
# survive the round trip (Get-Content/Set-Content would re-encode them).
$dir = $PSScriptRoot
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$html = [System.IO.File]::ReadAllText((Join-Path $dir "index.html"), [System.Text.Encoding]::UTF8)

# strip the webfont links: the test page must never wait on the network
$html = [regex]::Replace($html, '(?s)\s*<link[^>]*fonts\.(googleapis|gstatic)[^>]*>', '')

$scripts = @(
  '<script src="app.js"></script>',
  '<script src="dsp-check.js"></script>',
  '<script src="test-harness.js"></script>'
) -join "`n    "

$test = $html.Replace('<script src="app.js"></script>', $scripts)
$auto = $test.Replace(
  '<script src="test-harness.js"></script>',
  '<script src="test-harness.js"></script>' + "`n    " + '<script src="test-auto.js"></script>'
)
$shot = $html.Replace(
  '<script src="app.js"></script>',
  '<script src="app.js"></script>' + "`n    " + '<script src="screenshot.js"></script>'
)

[System.IO.File]::WriteAllText((Join-Path $dir "test.html"), $test, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dir "test-auto.html"), $auto, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $dir "screenshot.html"), $shot, $utf8NoBom)

foreach ($name in @("test.html", "test-auto.html", "screenshot.html")) {
  $text = [System.IO.File]::ReadAllText((Join-Path $dir $name), [System.Text.Encoding]::UTF8)
  "{0,-18} mojibake: {1}  scripts: {2}" -f $name, $text.Contains("Â·"), ([regex]::Matches($text, '<script src=').Count)
}
