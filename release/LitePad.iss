; LitePad Inno Setup 安装脚本
; 构建：需要 Windows 环境、Inno Setup 编译器 (ISCC)、已构建好的 LitePad.exe
; 典型 CI 用法（见 .github/workflows/ci.yml）：
;   $env:VERSION = "1.2.0"
;   ISCC LitePad.iss

#define AppName "LitePad"
#define AppVersion "1.2.0"
#define AppPublisher "LitePad"
#define AppExeName "LitePad.exe"
#define AppExeSource "../LitePad.exe"
#define AppExeDest "{app}\{#AppExeName}"

[Setup]
AppId={{B5C9F02D-1A23-4DEF-8B0F-4E9A1C3B2D44}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
DisableProgramGroupPage=yes
; 安装前清理旧版本文件（保留用户配置）
OutputBaseFilename=LitePad-Setup-{#AppVersion}
SetupIconFile=..\build\app.ico
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline dialog

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: unchecked
Name: "associate";   Description: "与 .txt / .md / .json / .yaml 等文本文件关联"; GroupDescription: "系统集成:"; Flags: unchecked

[Files]
Source: "{#AppExeSource}"; DestDir: "{app}"; Flags: ignoreversion
; 如以后需要安装额外资源（vendor/*.js），在此继续追加

[Icons]
Name: "{group}\{#AppName}"; Filename: "{#AppExeDest}"; IconFilename: "{#AppExeDest}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{#AppExeDest}"; IconFilename: "{#AppExeDest}"; Tasks: desktopicon
Name: "{autoprograms}\{#AppName}"; Filename: "{#AppExeDest}"; IconFilename: "{#AppExeDest}"

[Run]
; 安装后是否立即启动由用户决定
Filename: "{#AppExeDest}"; Description: "立即启动 {#AppName}"; Flags: nowait postinstall skipifsilent unchecked
