// Copyright 2026 Wing contributors. SPDX-License-Identifier: MIT
#include "wing_shell.h"
#include <map>
#include "include/cef_command_handler.h"
#include "include/cef_id_mappers.h"
#include "include/cef_request_handler.h"
#include "include/views/cef_box_layout.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_helpers.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/base/cef_callback.h"

namespace wing {
namespace {
constexpr char kShellURL[] = "chrome-extension://ffdbdinifhpfligbdnafflgamnkjookb/shell.html";
constexpr cef_color_t kFrameColor = 0xffe7e5ef;
// Non-owning window identity, owning sidebar view. Erased on native destruction.
std::map<int, CefRefPtr<CefBrowserView>> shells;
int next_window_id = 1000;

class ShellClient final : public CefClient, public CefRequestHandler,
                          public CefLoadHandler, public CefLifeSpanHandler {
 public:
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  void OnBeforeClose(CefRefPtr<CefBrowser>) override { closed_ = true; }
  void OnLoadError(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                   ErrorCode error, const CefString&, const CefString& url) override {
    // Extension registration can finish after OnContextInitialized. Only retry
    // this known bundled resource, with a finite budget and a teardown guard.
    if (frame->IsMain() && url == kShellURL && error == ERR_BLOCKED_BY_CLIENT && retries_++ < 4) {
      CefPostDelayedTask(TID_UI, base::BindOnce(&ShellClient::Retry, this, browser), 500);
    }
  }
  void Retry(CefRefPtr<CefBrowser> browser) {
    if (!closed_) browser->GetMainFrame()->LoadURL(kShellURL);
  }
  bool OnBeforeBrowse(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame,
                      CefRefPtr<CefRequest> request, bool, bool) override {
    // The app chrome is a privileged extension page, never a navigation target.
    const auto url = request->GetURL().ToString();
    const bool blocked = frame->IsMain() && url.rfind("chrome-extension://ffdbdinifhpfligbdnafflgamnkjookb/", 0) != 0;
    return blocked;
  }
 private:
  bool closed_ = false;
  int retries_ = 0;
  IMPLEMENT_REFCOUNTING(ShellClient);
};
class SidebarDelegate final : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  CefSize GetPreferredSize(CefRefPtr<CefView>) override { return CefSize(256, 800); }
 private:
  IMPLEMENT_REFCOUNTING(SidebarDelegate);
};

class ShellWindowDelegate final : public CefWindowDelegate {
 public:
  ShellWindowDelegate(CefRefPtr<CefBrowserView> content, cef_show_state_t show_state)
      : content_(content), show_state_(show_state) {}
  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->SetID(next_window_id++);
    window->SetTitle("Wing");
    window->SetBackgroundColor(kFrameColor);
    CefBoxLayoutSettings layout;
    layout.horizontal = true;
    layout.cross_axis_alignment = CEF_AXIS_ALIGNMENT_STRETCH;
    layout.inside_border_insets = CefInsets(8, 0, 8, 8);
    auto box = window->SetToBoxLayout(layout);
    CefBrowserSettings settings;
    sidebar_ = CefBrowserView::CreateBrowserView(new ShellClient, kShellURL,
                    settings, nullptr, nullptr, new SidebarDelegate);
    // Experimental: Chrome Views content exposes a popup tab model.
    // See docs/CEF-SHELL-LIMITATIONS.md before enabling outside engine tests.
    window->AddChildView(content_);
    window->AddChildViewAt(sidebar_, 0);
    box->SetFlexForView(content_, 1);
    box->SetFlexForView(sidebar_, 0);
    shells.emplace(window->GetID(), sidebar_);
    CefDraggableRegion drag;
    drag.bounds = CefRect(84, 0, 170, 38);
    drag.draggable = true;
    window->SetDraggableRegions({drag});
    window->Layout();
    if (show_state_ != CEF_SHOW_STATE_HIDDEN) window->Show();
  }
  bool IsFrameless(CefRefPtr<CefWindow>) override { return true; }
  bool WithStandardWindowButtons(CefRefPtr<CefWindow>) override { return true; }
  bool GetTitlebarHeight(CefRefPtr<CefWindow>, float* height) override {
    *height = 44;
    return true;
  }
  CefSize GetPreferredSize(CefRefPtr<CefView>) override { return CefSize(1360, 900); }
  CefSize GetMinimumSize(CefRefPtr<CefView>) override { return CefSize(760, 500); }
  cef_show_state_t GetInitialShowState(CefRefPtr<CefWindow>) override { return show_state_; }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  bool CanClose(CefRefPtr<CefWindow>) override {
    auto browser = content_->GetBrowser();
    return !browser || browser->GetHost()->TryCloseBrowser();
  }
  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    shells.erase(window->GetID());
    sidebar_ = nullptr;
    content_ = nullptr;
  }
 private:
  CefRefPtr<CefBrowserView> content_;
  CefRefPtr<CefBrowserView> sidebar_;
  cef_show_state_t show_state_;
  IMPLEMENT_REFCOUNTING(ShellWindowDelegate);
};
class ContentDelegate final : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_CHROME; }
  ChromeToolbarType GetChromeToolbarType(CefRefPtr<CefBrowserView>) override { return CEF_CTT_NONE; }
  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView>,
                CefRefPtr<CefBrowserView> popup, bool is_devtools) override {
    CreateShellWindow(popup);
    return true;
  }
 private:
  IMPLEMENT_REFCOUNTING(ContentDelegate);
};
}  // namespace

void CreateShellWindow(CefRefPtr<CefBrowserView> content, cef_show_state_t show_state) {
  CEF_REQUIRE_UI_THREAD();
  CefWindow::CreateTopLevelWindow(new ShellWindowDelegate(content, show_state));
}
CefRefPtr<CefBrowserViewDelegate> ContentViewDelegate() { return new ContentDelegate; }
bool HandleShellCommand(CefRefPtr<CefBrowser> browser, int command_id) {
  auto content = CefBrowserView::GetForBrowser(browser);
  if (!content || !content->GetWindow()) return false;
  auto it = shells.find(content->GetWindow()->GetID());
  if (it == shells.end()) return false;
  const char* action = nullptr;
  if (command_id == cef_id_for_command_id_name("IDC_NEW_TAB")) action = "new-tab";
  if (command_id == cef_id_for_command_id_name("IDC_FOCUS_LOCATION")) action = "address";
  if (!action) return false;
  auto sidebar = it->second->GetBrowser();
  if (!sidebar) return false;
  sidebar->GetMainFrame()->ExecuteJavaScript(
      std::string("window.dispatchEvent(new CustomEvent('wing-command',{detail:'") + action + "'}));", kShellURL, 1);
  sidebar->GetHost()->SetFocus(true);
  return true;
}
}  // namespace wing
