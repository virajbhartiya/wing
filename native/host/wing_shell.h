#ifndef WING_SHELL_H_
#define WING_SHELL_H_
#include "include/cef_browser.h"
#include "include/cef_client.h"
#include "include/views/cef_browser_view.h"
namespace wing {
void CreateShellWindow(CefRefPtr<CefBrowserView> content,
                       cef_show_state_t show_state = CEF_SHOW_STATE_NORMAL);
CefRefPtr<CefBrowserViewDelegate> ContentViewDelegate();
bool HandleShellCommand(CefRefPtr<CefBrowser> browser, int command_id);
}
#endif
