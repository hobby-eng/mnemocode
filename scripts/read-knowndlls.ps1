# Lists the \KnownDlls object directory of this Windows, whose DLLs the loader always takes from
# the system, and fails unless it holds every DLL of scripts/knowndlls.json besides ntdll.dll,
# which the kernel maps itself (W-DLL-SEARCH). Run on each Windows runner of CI:
#
#   pwsh -NoProfile -File scripts/read-knowndlls.ps1
#
# PowerShell, not Node (TOOL-01): reading an object directory needs ntdll's calls, and Node has no
# way to call a DLL; PowerShell compiles the few lines of C# below on the runner itself.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class KnownDllsDirectory {
    [StructLayout(LayoutKind.Sequential)]
    struct UnicodeString { public ushort Length; public ushort MaximumLength; public IntPtr Buffer; }

    [StructLayout(LayoutKind.Sequential)]
    struct ObjectAttributes {
        public int Length; public IntPtr RootDirectory; public IntPtr ObjectName; public uint Attributes;
        public IntPtr SecurityDescriptor; public IntPtr SecurityQualityOfService;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct DirectoryEntry { public UnicodeString Name; public UnicodeString TypeName; }

    [DllImport("ntdll.dll")]
    static extern int NtOpenDirectoryObject(out IntPtr handle, uint access, ref ObjectAttributes attributes);
    [DllImport("ntdll.dll")]
    static extern int NtQueryDirectoryObject(IntPtr handle, IntPtr buffer, int length,
        [MarshalAs(UnmanagedType.U1)] bool single, [MarshalAs(UnmanagedType.U1)] bool restart,
        ref uint context, out uint returned);
    [DllImport("ntdll.dll")]
    static extern int NtClose(IntPtr handle);

    const uint DirectoryQuery = 0x0001;
    const uint CaseInsensitive = 0x40;
    const int BufferBytes = 1 << 16;

    public static List<string> Sections() {
        string path = "\\KnownDlls";
        IntPtr text = Marshal.StringToHGlobalUni(path);
        UnicodeString name = new UnicodeString {
            Length = (ushort)(path.Length * 2), MaximumLength = (ushort)(path.Length * 2 + 2), Buffer = text };
        IntPtr namePointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeString)));
        IntPtr buffer = Marshal.AllocHGlobal(BufferBytes);
        IntPtr handle = IntPtr.Zero;
        try {
            Marshal.StructureToPtr(name, namePointer, false);
            ObjectAttributes attributes = new ObjectAttributes {
                Length = Marshal.SizeOf(typeof(ObjectAttributes)), ObjectName = namePointer,
                Attributes = CaseInsensitive };
            int status = NtOpenDirectoryObject(out handle, DirectoryQuery, ref attributes);
            if (status != 0) throw new Exception("NtOpenDirectoryObject failed: 0x" + status.ToString("x8"));
            List<string> names = new List<string>();
            uint context = 0;
            bool restart = true;
            while (true) {
                uint returned;
                status = NtQueryDirectoryObject(handle, buffer, BufferBytes, true, restart, ref context, out returned);
                restart = false;
                // NT_SUCCESS: zero and the other success codes go on; STATUS_NO_MORE_ENTRIES ends it.
                if (status < 0) break;
                DirectoryEntry entry = (DirectoryEntry)Marshal.PtrToStructure(buffer, typeof(DirectoryEntry));
                string type = Marshal.PtrToStringUni(entry.TypeName.Buffer, entry.TypeName.Length / 2);
                if (type == "Section") names.Add(Marshal.PtrToStringUni(entry.Name.Buffer, entry.Name.Length / 2));
            }
            // STATUS_NO_MORE_ENTRIES ends the listing; any other status is a failure.
            if (status != unchecked((int)0x8000001A)) throw new Exception("NtQueryDirectoryObject failed: 0x" + status.ToString("x8"));
            return names;
        } finally {
            if (handle != IntPtr.Zero) NtClose(handle);
            Marshal.FreeHGlobal(buffer);
            Marshal.FreeHGlobal(namePointer);
            Marshal.FreeHGlobal(text);
        }
    }
}
"@

$listed = [KnownDllsDirectory]::Sections() | ForEach-Object { $_.ToLowerInvariant() } | Sort-Object -Unique
$version = [System.Environment]::OSVersion.VersionString
Write-Output "\KnownDlls on $version ($($listed.Count) sections):"
$listed | ForEach-Object { Write-Output "  $_" }
$stored = (Get-Content -Raw -Path (Join-Path $PSScriptRoot "knowndlls.json") | ConvertFrom-Json).dlls
$missing = $stored | Where-Object { $_ -ne "ntdll.dll" -and $listed -notcontains $_.ToLowerInvariant() }
if ($missing) {
    Write-Error "Not KnownDLLs on this Windows: $($missing -join ', ')"
    exit 1
}
Write-Output "Every DLL of scripts/knowndlls.json is a KnownDLL here."
