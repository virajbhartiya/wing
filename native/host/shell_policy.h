#ifndef WING_SHELL_POLICY_H_
#define WING_SHELL_POLICY_H_
namespace wing {
// Experimental Views composition cannot yet provide Chrome multi-tab semantics.
// The primary Wing app is the independent custom shell; this host is an engine lab.
constexpr bool UseCustomShell(bool experimental_shell, bool native_diagnostic) {
  return experimental_shell && !native_diagnostic;
}
}
#endif
