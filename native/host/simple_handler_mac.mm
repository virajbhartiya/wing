// Copyright (c) 2013 The Chromium Embedded Framework Authors. All rights
// reserved. Use of this source code is governed by a BSD-style license that
// can be found in the LICENSE file.

#include "simple_handler.h"
#include "wing_shell.h"

#include <float.h>
#import <Cocoa/Cocoa.h>

#include "include/cef_browser.h"

namespace {

NSWindow* GetNSWindowForBrowser(CefRefPtr<CefBrowser> browser) {
  NSView* view =
      CAST_CEF_WINDOW_HANDLE_TO_NSVIEW(browser->GetHost()->GetWindowHandle());
  return [view window];
}

}  // namespace

void SimpleHandler::PlatformTitleChange(CefRefPtr<CefBrowser> browser,
                                        const CefString& title) {
  NSWindow* window = GetNSWindowForBrowser(browser);
  std::string titleStr(title);
  NSString* str = [NSString stringWithUTF8String:titleStr.c_str()];
  [window setTitle:str];
}

void SimpleHandler::PlatformShowWindow(CefRefPtr<CefBrowser> browser) {
  NSWindow* window = GetNSWindowForBrowser(browser);
  [window makeKeyAndOrderFront:window];
}

void SimpleHandler::ExecuteCommand(int command_id) {
  for (auto browser : browser_list_) {
    NSWindow* window = GetNSWindowForBrowser(browser);
    if ([window isKeyWindow] && wing::HandleShellCommand(browser, command_id)) return;
    if ([window isKeyWindow] && browser->GetHost()->CanExecuteChromeCommand(command_id)) {
      browser->GetHost()->ExecuteChromeCommand(command_id, CEF_WOD_CURRENT_TAB);
      return;
    }
  }
}
