#import "ExtensionSidebar.h"
@interface WingSidebarView : NSView
@end
@implementation WingSidebarView
- (BOOL)isFlipped { return YES; }
@end
@interface WingExtensionSidebar () <ArdiaCoreTabDelegate>
@end
@implementation WingExtensionSidebar {
  WingSidebarView *_container;
  NSButton *_closeButton;
  NSTextField *_title;
}
@synthesize page = _page, extensionId = _extensionId;
- (BOOL)open:(NSString *)extensionId from:(ArdiaCoreTab *)owner browser:(ArdiaCoreWindow *)browser {
  NSString *url = [owner sidePanelURLForExtension:extensionId];
  if (![url hasPrefix:[NSString stringWithFormat:@"chrome-extension://%@/", extensionId]])
    return NO;
  [self close];
  _page = [browser openExtensionView:url profile:owner.profile kind:@"sidePanel"];
  if (!_page) return NO;
  _extensionId = [extensionId copy];
  _page.delegate = self;
  _container = [WingSidebarView new];
  _container.wantsLayer = YES;
  _container.layer.backgroundColor = NSColor.windowBackgroundColor.CGColor;
  _title = [NSTextField labelWithString:@"Extension panel"];
  _title.lineBreakMode = NSLineBreakByTruncatingTail;
  _closeButton = [NSButton buttonWithTitle:@"Close" target:self action:@selector(close:)];
  _closeButton.accessibilityLabel = @"Close extension side panel";
  [_container addSubview:_title];
  [_container addSubview:_closeButton];
  [_container addSubview:_page.view];
  return YES;
}
- (void)layoutIn:(NSView *)host frame:(NSRect)frame visible:(BOOL)visible {
  if (!_page) return;
  if (!visible) {
    [_page noteShownByHost:NO];
    [_container removeFromSuperview];
    return;
  }
  if (_container.superview != host) [host addSubview:_container];
  _container.frame = frame;
  _title.frame = NSMakeRect(12, 8, MAX(1, frame.size.width - 90), 24);
  _closeButton.frame = NSMakeRect(frame.size.width - 72, 4, 64, 30);
  _page.view.frame = NSMakeRect(0, 38, frame.size.width, MAX(1, frame.size.height - 38));
  _page.view.hidden = NO;
  [_page noteShownByHost:YES];
}
- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab {
  if (tab == _page && tab.title.length) _title.stringValue = tab.title;
}
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  if (tab == _page) [self close];
}
- (void)close:(id)sender { [self close]; }
- (void)close {
  if (!_page) return;
  ArdiaCoreTab *page = _page;
  _page = nil;
  _extensionId = nil;
  page.delegate = nil;
  [_container removeFromSuperview];
  _container = nil;
  [page noteShownByHost:NO];
  [page closeNow];
  if (self.onClose) self.onClose();
}
@end
