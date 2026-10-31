#import "wing_updates.h"
#import <Sparkle/Sparkle.h>
@implementation WingUpdates
+ (void)installInMenu:(NSMenu*)menu {
  static SPUStandardUpdaterController* controller;
  NSDictionary* info = NSBundle.mainBundle.infoDictionary;
  NSString* feed = info[@"SUFeedURL"];
  NSString* key = info[@"SUPublicEDKey"];
  BOOL configured = [feed hasPrefix:@"https://"] && key.length > 0;
  NSMenuItem* item = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…" action:nil keyEquivalent:@""];
  if (configured) {
    controller = [[SPUStandardUpdaterController alloc] initWithStartingUpdater:YES updaterDelegate:nil userDriverDelegate:nil];
    item.target = controller;
    item.action = @selector(checkForUpdates:);
  } else {
    item.title = @"Updates unavailable — local development build";
    item.enabled = NO;
  }
  [menu addItem:item];
}
@end
