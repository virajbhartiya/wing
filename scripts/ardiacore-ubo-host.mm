// Wing's isolated engine qualification host. ArdiaCore API: Apache-2.0,
// Copyright 2026 Mantra Patel; linked engine distribution: GPL-3.0.
// This original host is a test artifact, not the Wing application.
#import <AppKit/AppKit.h>
#import "ArdiaCore.h"
#include <string>
#include <vector>

@interface WingQualification : NSObject <ArdiaCoreEngineDelegate, ArdiaCoreWindowDelegate>
@end
@implementation WingQualification {
  ArdiaCoreWindow *_window;
  ArdiaCoreTab *_page;
  ArdiaCoreTab *_dashboard;
  NSMutableDictionary *_report;
}
- (void)engineDidStart {
  [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
  _report = [@{@"chromium":engine.chromiumVersion, @"enabled":@NO} mutableCopy];
  _window = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600)];
  _window.delegate = self;
  const char *extension = getenv("WING_UBO_EXTENSION");
  if (extension && *extension) {
    _report[@"enabled"] = @YES;
    NSString *extensionId = [engine.defaultProfile loadComponentExtension:@(extension)];
    _report[@"extensionId"] = extensionId ?: NSNull.null;
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC),dispatch_get_main_queue(),^{
    self->_report[@"extensions"] = engine.defaultProfile.extensions;
    const char *mode = getenv("WING_UBO_MODE");
    if (mode && *mode && extension && *extension) {
      NSString *url = [NSString stringWithFormat:@"chrome-extension://%@/1p-filters.html",self->_report[@"extensionId"]];
      self->_dashboard = [self->_window openTab:url profile:engine.defaultProfile foreground:YES];
      [self->_window.hostView addSubview:self->_dashboard.view];
      self->_dashboard.view.frame = self->_window.hostView.bounds;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
        NSString *script = @"(async()=>{const value=await vAPI.messaging.send('dashboard',{what:'readUserFilters'});const lists=await vAPI.messaging.send('dashboard',{what:'getLists'});value.lists={genericDisabled:lists.ignoreGenericCosmeticFilters,cosmeticEnabled:lists.parseCosmeticFilters,cosmeticCount:lists.cosmeticFilterCount,imported:lists.current[COOKIE_LIST_URL]};post('result',JSON.stringify(value))})().catch(e=>post('result',JSON.stringify({error:String(e)})))";
        if (strcmp(mode,"configure")==0) script = @"(async()=>{await vAPI.messaging.send('dashboard',{what:'writeUserFilters',enabled:true,content:'wing-fixture.invalid###wing-fixture-ad\\n@@||doubleclick.net^\\n'});await vAPI.messaging.send('dashboard',{what:'applyFilterListSelection',toImport:COOKIE_LIST_URL,merge:true});await vAPI.messaging.send('dashboard',{what:'reloadAllFilters'});const value=await vAPI.messaging.send('dashboard',{what:'readUserFilters'});const lists=await vAPI.messaging.send('dashboard',{what:'getLists'});value.lists={genericDisabled:lists.ignoreGenericCosmeticFilters,cosmeticEnabled:lists.parseCosmeticFilters,cosmeticCount:lists.cosmeticFilterCount,imported:lists.current[COOKIE_LIST_URL]};post('result',JSON.stringify(value))})().catch(e=>post('result',JSON.stringify({error:String(e)})))";
        NSData *cookieJSON = [NSJSONSerialization dataWithJSONObject:@[@(getenv("WING_UBO_COOKIE_URL"))] options:0 error:nil];
        NSString *cookieArray = [[NSString alloc] initWithData:cookieJSON encoding:NSUTF8StringEncoding];
        script = [script stringByReplacingOccurrencesOfString:@"COOKIE_LIST_URL" withString:[NSString stringWithFormat:@"(%@)[0]",cookieArray]];
        [self->_dashboard evaluate:script completion:^(NSString *json){
          self->_report[@"filterSettings"] = json ?: NSNull.null;
          [self startFixture];
        }];
      });
    } else [self startFixture];
  });
}

- (void)startFixture {
  ArdiaCoreEngine *engine = ArdiaCoreEngine.sharedEngine;
    self->_page = [self->_window openTab:@(getenv("WING_UBO_URL")) profile:engine.defaultProfile foreground:YES];
    [self->_window.hostView addSubview:self->_page.view];
    self->_page.view.frame = self->_window.hostView.bounds;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW,5*NSEC_PER_SEC),dispatch_get_main_queue(),^{
      [self->_page evaluate:@"post('result', JSON.stringify({...window.results,cosmeticDisplay:getComputedStyle(document.querySelector('#wing-fixture-ad')).display,cookieDisplay:getComputedStyle(document.querySelector('#cookie-banner')).display}))" completion:^(NSString *json) {
        self->_report[@"evaluation"] = json ?: NSNull.null;
        NSData *data=[NSJSONSerialization dataWithJSONObject:self->_report options:NSJSONWritingPrettyPrinted error:nil];
        [data writeToFile:@(getenv("WING_UBO_REPORT")) atomically:YES];
        [self->_page closeNow];
        if(self->_dashboard) [self->_dashboard closeNow];
        [self->_window close];
        [engine quit];
      }];
    });
}
- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window { return YES; }
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    std::string profile = std::string("--user-data-dir=") + getenv("WING_UBO_PROFILE");
    std::vector<const char *> args(argv,argv+argc);
    args.push_back(profile.c_str());
    args.push_back("--host-resolver-rules=MAP * 127.0.0.1");
    args.push_back("--no-proxy-server");
    args.push_back("--enable-logging=stderr");
    args.push_back("--disable-background-networking");
    args.push_back("--use-mock-keychain");
    args.push_back("--password-store=basic");
    args.push_back("--disable-backgrounding-occluded-windows");
    args.push_back("--ardia-test-external-protocol-no-launch");
    args.push_back("--disable-media-route-providers-for-test");
    static WingQualification *host = [WingQualification new];
    return [ArdiaCoreEngine runWithArgc:(int)args.size() argv:args.data() delegate:host];
  }
}
