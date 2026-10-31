#import "ExtensionPanel.h"
@interface WingExtensionPanel () <NSPopoverDelegate, ArdiaCoreTabDelegate>
@end
@implementation WingExtensionPanel {
  NSPopover *_popover;
  ArdiaCoreTab *_tab;
}
- (BOOL)showURL:(NSString *)url
        browser:(ArdiaCoreWindow *)browser
        profile:(ArdiaCoreProfile *)profile {
  [self close];
  _tab = [browser openExtensionView:url profile:profile kind:@"popup"];
  if (!_tab)
    return NO;
  _tab.delegate = self;
  NSViewController *controller = [NSViewController new];
  controller.view = _tab.view;
  _popover = [NSPopover new];
  _popover.delegate = self;
  _popover.behavior = NSPopoverBehaviorTransient;
  _popover.contentViewController = controller;
  _popover.contentSize = NSMakeSize(400, 500);
  NSView *host = browser.hostView;
  CGFloat y = host.isFlipped ? 32 : host.bounds.size.height - 32;
  [_popover showRelativeToRect:NSMakeRect(MAX(0, host.bounds.size.width - 56),
                                          y, 24, 24)
                        ofView:host
                 preferredEdge:host.isFlipped ? NSMaxYEdge : NSMinYEdge];
  [_tab noteShownByHost:YES];
  [_tab focus];
  return YES;
}
- (void)tab:(ArdiaCoreTab *)tab preferredSizeDidChange:(NSSize)size {
  if (tab != _tab)
    return;
  _popover.contentSize = NSMakeSize(MIN(800, MAX(120, size.width)),
                                    MIN(600, MAX(80, size.height)));
}
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  if (tab == _tab)
    [self close];
}
- (void)popoverDidClose:(NSNotification *)notification {
  if (notification.object == _popover)
    [self close];
}
- (void)close {
  NSPopover *popover = _popover;
  ArdiaCoreTab *tab = _tab;
  _popover = nil;
  _tab = nil;
  popover.delegate = nil;
  [popover close];
  tab.delegate = nil;
  [tab noteShownByHost:NO];
  [tab closeNow];
}
@end
