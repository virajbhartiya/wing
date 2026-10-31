// Copyright (c) 2013 The Chromium Embedded Framework Authors.
// Portions copyright (c) 2010 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#import <Cocoa/Cocoa.h>
#include <filesystem>

#include "include/cef_application_mac.h"
#include "include/cef_command_line.h"
#include "include/cef_id_mappers.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_library_loader.h"
#include "simple_app.h"
#import "wing_updates.h"
#include "simple_handler.h"

// Receives notifications from the application.
@interface SimpleAppDelegate : NSObject <NSApplicationDelegate>

- (void)createApplication:(id)object;
- (void)chromeCommand:(NSMenuItem*)sender;
- (void)tryToTerminateApplication:(NSApplication*)app;
@end

// Provide the CefAppProtocol implementation required by CEF.
@interface SimpleApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation SimpleApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

// |-terminate:| is the entry point for orderly "quit" operations in Cocoa. This
// includes the application menu's quit menu item and keyboard equivalent, the
// application's dock icon menu's quit menu item, "quit" (not "force quit") in
// the Activity Monitor, and quits triggered by user logout and system restart
// and shutdown.
//
// The default |-terminate:| implementation ends the process by calling exit(),
// and thus never leaves the main run loop. This is unsuitable for Chromium
// since Chromium depends on leaving the main run loop to perform an orderly
// shutdown. We support the normal |-terminate:| interface by overriding the
// default implementation. Our implementation, which is very specific to the
// needs of Chromium, works by asking the application delegate to terminate
// using its |-tryToTerminateApplication:| method.
//
// |-tryToTerminateApplication:| differs from the standard
// |-applicationShouldTerminate:| in that no special event loop is run in the
// case that immediate termination is not possible (e.g., if dialog boxes
// allowing the user to cancel have to be shown). Instead, this method tries to
// close all browsers by calling CloseBrowser(false) via
// ClientHandler::CloseAllBrowsers. Calling CloseBrowser will result in a call
// to ClientHandler::DoClose and execution of |-performClose:| on the NSWindow.
// DoClose sets a flag that is used to differentiate between new close events
// (e.g., user clicked the window close button) and in-progress close events
// (e.g., user approved the close window dialog). The NSWindowDelegate
// |-windowShouldClose:| method checks this flag and either calls
// CloseBrowser(false) in the case of a new close event or destructs the
// NSWindow in the case of an in-progress close event.
// ClientHandler::OnBeforeClose will be called after the CEF NSView hosted in
// the NSWindow is dealloc'ed.
//
// After the final browser window has closed ClientHandler::OnBeforeClose will
// begin actual tear-down of the application by calling CefQuitMessageLoop.
// This ends the NSApplication event loop and execution then returns to the
// main() function for cleanup before application termination.
//
// The standard |-applicationShouldTerminate:| is not supported, and code paths
// leading to it must be redirected.
- (void)terminate:(id)sender {
  SimpleAppDelegate* delegate =
      static_cast<SimpleAppDelegate*>([NSApp delegate]);
  [delegate tryToTerminateApplication:self];
  // Return, don't exit. The application is responsible for exiting on its own.
}
@end

@implementation SimpleAppDelegate

// Create the application on the UI thread.
- (void)createApplication:(id)object {
  NSMenu* menu = [[NSMenu alloc] init];
  NSMenuItem* appItem = [menu addItemWithTitle:@"Wing" action:nil keyEquivalent:@""];
  NSMenu* appMenu = [[NSMenu alloc] initWithTitle:@"Wing"];
  [appMenu addItemWithTitle:@"About Wing" action:@selector(orderFrontStandardAboutPanel:) keyEquivalent:@""];
  [WingUpdates installInMenu:appMenu];
  [appMenu addItem:[NSMenuItem separatorItem]];
  [appMenu addItemWithTitle:@"Hide Wing" action:@selector(hide:) keyEquivalent:@"h"];
  [appMenu addItemWithTitle:@"Quit Wing" action:@selector(terminate:) keyEquivalent:@"q"];
  appItem.submenu = appMenu;
  auto add = [&](NSMenu* target, NSString* title, const char* command, NSString* key, bool shift = false) {
    int identifier = cef_id_for_command_id_name(command);
    if (identifier < 0) return;
    NSMenuItem* item = [target addItemWithTitle:title action:@selector(chromeCommand:) keyEquivalent:key];
    item.target = self;
    item.tag = identifier;
    item.keyEquivalentModifierMask = NSEventModifierFlagCommand | (shift ? NSEventModifierFlagShift : 0);
  };
  auto section = [&](NSString* title) {
    NSMenu* submenu = [[NSMenu alloc] initWithTitle:title];
    [menu addItemWithTitle:title action:nil keyEquivalent:@""].submenu = submenu;
    return submenu;
  };
  NSMenu* file = section(@"File");
  add(file, @"New Tab", "IDC_NEW_TAB", @"t");
  add(file, @"New Window", "IDC_NEW_WINDOW", @"n");
  add(file, @"New Private Window", "IDC_NEW_INCOGNITO_WINDOW", @"n", true);
  add(file, @"Reopen Closed Tab", "IDC_RESTORE_TAB", @"t", true);
  add(file, @"Close Tab", "IDC_CLOSE_TAB", @"w");
  add(file, @"Save Page…", "IDC_SAVE_PAGE", @"s");
  add(file, @"Print…", "IDC_PRINT", @"p");
  NSMenu* edit = section(@"Edit");
  [edit addItemWithTitle:@"Undo" action:@selector(undo:) keyEquivalent:@"z"];
  [edit addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
  [edit addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
  [edit addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
  [edit addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
  add(edit, @"Find…", "IDC_FIND", @"f");
  NSMenu* view = section(@"View");
  add(view, @"Focus Address Bar", "IDC_FOCUS_LOCATION", @"l");
  add(view, @"Reload", "IDC_RELOAD", @"r");
  add(view, @"New Split View", "IDC_NEW_SPLIT_TAB", @"2", true);
  add(view, @"Toggle Vertical Tabs", "IDC_TOGGLE_VERTICAL_TABS", @"");
  add(view, @"Collapse Vertical Tabs", "IDC_TOGGLE_VERTICAL_TABS_COLLAPSE", @"");
  add(view, @"Zoom In", "IDC_ZOOM_PLUS", @"+");
  add(view, @"Zoom Out", "IDC_ZOOM_MINUS", @"-");
  add(view, @"Actual Size", "IDC_ZOOM_NORMAL", @"0");
  add(view, @"Developer Tools", "IDC_DEV_TOOLS", @"i", true);
  NSMenu* browser = section(@"Browser");
  add(browser, @"History", "IDC_SHOW_HISTORY", @"y");
  add(browser, @"Downloads", "IDC_SHOW_DOWNLOADS", @"j", true);
  add(browser, @"Extensions", "IDC_MANAGE_EXTENSIONS", @"");
  add(browser, @"Task Manager", "IDC_TASK_MANAGER", @"");
  add(browser, @"Settings", "IDC_OPTIONS", @",");
  NSApp.mainMenu = menu;

  // Set the delegate for application events.
  [[NSApplication sharedApplication] setDelegate:self];
}

- (void)chromeCommand:(NSMenuItem*)sender {
  auto handler = SimpleHandler::GetInstance();
  if (handler) handler->ExecuteCommand(static_cast<int>(sender.tag));
}

- (void)tryToTerminateApplication:(NSApplication*)app {
  SimpleHandler* handler = SimpleHandler::GetInstance();
  if (handler && !handler->IsClosing()) {
    handler->CloseAllBrowsers(false);
  }
}

- (NSApplicationTerminateReply)applicationShouldTerminate:
    (NSApplication*)sender {
  return NSTerminateNow;
}

// Called when the user clicks the app dock icon while the application is
// already running.
- (BOOL)applicationShouldHandleReopen:(NSApplication*)theApplication
                    hasVisibleWindows:(BOOL)flag {
  SimpleHandler* handler = SimpleHandler::GetInstance();
  if (handler && !handler->IsClosing()) {
    handler->ShowMainWindow();
  }
  return NO;
}

// Requests that any state restoration archive be created with secure encoding
// (macOS 12+ only). See https://crrev.com/c737387656 for details. This also
// fixes an issue with macOS default behavior incorrectly restoring windows
// after hard reset (holding down the power button).
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
  return YES;
}
@end

// Entry point function for the browser process.
int main(int argc, char* argv[]) {
  // Load the CEF framework library at runtime instead of linking directly
  // as required by the macOS sandbox implementation.
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) {
    return 1;
  }

  // Provide CEF with command-line arguments.
  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    // Initialize the SimpleApplication instance.
    [SimpleApplication sharedApplication];

    // If there was an invocation to NSApp prior to this method, then the NSApp
    // will not be a SimpleApplication, but will instead be an NSApplication.
    // This is undesirable and we must enforce that this doesn't happen.
    CHECK([NSApp isKindOfClass:[SimpleApplication class]]);

    // Parse command-line arguments for use in this method.
    CefRefPtr<CefCommandLine> command_line =
        CefCommandLine::CreateCommandLine();
    command_line->InitFromArgv(argc, argv);

    // Specify CEF global settings here.
    CefSettings settings;
    NSString* support = [NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES) firstObject];
    NSString* profileName = [[[NSBundle mainBundle] bundleIdentifier] hasSuffix:@".development"] ? @"Wing Native Development" : @"Wing Native";
    NSString* root = [support stringByAppendingPathComponent:profileName];
    std::string cache = command_line->GetSwitchValue("cache-path").ToString();
    if (cache.empty()) cache = [root UTF8String];
    std::error_code path_error;
    std::filesystem::create_directories(cache, path_error);
    if (path_error) return 1;
    cache = std::filesystem::canonical(cache, path_error).string();
    if (path_error) return 1;
    CefString(&settings.root_cache_path) = cache;
    CefString(&settings.cache_path) = cache + "/Default";
    settings.persist_session_cookies = true;

    // When generating projects with CMake the CEF_USE_SANDBOX value will be
    // defined automatically. Pass -DUSE_SANDBOX=OFF to the CMake command-line
    // to disable use of the sandbox.
#if !defined(CEF_USE_SANDBOX)
    settings.no_sandbox = true;
#endif

    // SimpleApp implements application-level callbacks for the browser process.
    // It will create the first browser instance in OnContextInitialized() after
    // CEF has initialized.
    CefRefPtr<SimpleApp> app(new SimpleApp);

    // Initialize the CEF browser process. May return false if initialization
    // fails or if early exit is desired (for example, due to process singleton
    // relaunch behavior).
    if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
      return CefGetExitCode();
    }

    // Create the application delegate.
    SimpleAppDelegate* delegate = [[SimpleAppDelegate alloc] init];
    // Set as the delegate for application events.
    NSApp.delegate = delegate;

    [delegate performSelectorOnMainThread:@selector(createApplication:)
                               withObject:nil
                            waitUntilDone:NO];

    // Run the CEF message loop. This will block until CefQuitMessageLoop() is
    // called.
    CefRunMessageLoop();

    // Shut down CEF.
    CefShutdown();

    // Release the delegate.
#if !__has_feature(objc_arc)
    [delegate release];
#endif  // !__has_feature(objc_arc)
    delegate = nil;
  }  // @autoreleasepool

  return 0;
}
