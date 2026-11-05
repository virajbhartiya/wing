#import "MiniWindow.h"
#import "ArdiaCore.h"

static NSMutableArray *gMinis;

@interface WingMiniWindow () <ArdiaCoreWindowDelegate, ArdiaCoreTabDelegate, NSToolbarDelegate,
                              NSTextFieldDelegate>
@end

@implementation WingMiniWindow {
  ArdiaCoreWindow *_core;
  ArdiaCoreTab *_tab;
  NSTextField *_address;
  NSPopUpButton *_profile;
  NSToolbarItem *_back, *_forward, *_expand;
  NSArray<NSDictionary *> *_spaces;
  NSString *_spaceId, *_search, *_lastVisit;
  WingMiniProfileLoader _loader;
  WingMiniExpand _expandHandler;
  WingMiniVisit _visit;
  BOOL _closing, _opening;
}

+ (NSUInteger)openCount {
  return gMinis.count;
}

+ (NSArray<NSDictionary *> *)diagnostics {
  NSMutableArray *windows = [NSMutableArray new];
  for (WingMiniWindow *mini in gMinis)
    [windows addObject:@{
      @"url" : mini->_tab.url ?: @"",
      @"profile" : mini->_tab.profile.name ?: @"",
      @"spaceId" : mini->_spaceId ?: @"",
      @"visible" : @(mini->_core.window.visible)
    }];
  return windows;
}
+ (void)closeAll {
  for (WingMiniWindow *mini in [gMinis copy]) [mini->_core.window performClose:nil];
}

+ (void)openURL:(NSString *)url
         spaces:(NSArray<NSDictionary *> *)spaces
        spaceId:(NSString *)spaceId
         search:(NSString *)searchPrefix
         loader:(WingMiniProfileLoader)loader
         expand:(WingMiniExpand)expand
          visit:(WingMiniVisit)visit {
  WingMiniWindow *mini = [self new];
  mini->_spaces = spaces;
  mini->_spaceId = spaceId;
  mini->_search = searchPrefix;
  mini->_loader = loader;
  mini->_expandHandler = expand;
  mini->_visit = visit;
  gMinis = gMinis ?: [NSMutableArray new];
  [gMinis addObject:mini];
  [mini loadPage:url adopting:nil];
}

- (NSString *)profileIdForSpace:(NSString *)spaceId {
  for (NSDictionary *space in _spaces)
    if ([space[@"id"] isEqual:spaceId]) return space[@"profileId"];
  return _spaces.firstObject[@"profileId"];
}

- (void)loadPage:(NSString *)url adopting:(ArdiaCoreTab *)adopted {
  _loader([self profileIdForSpace:_spaceId], ^(ArdiaCoreProfile *profile) {
    if (self->_closing) return;
    if (!profile) {
      if (!self->_core) [gMinis removeObject:self];
      return;
    }
    [self attachProfile:profile url:url adopting:adopted];
  });
}

- (void)attachProfile:(ArdiaCoreProfile *)profile url:(NSString *)url adopting:(ArdiaCoreTab *)adopted {
  BOOL first = !_core;
  if (first) {
    _core = [[ArdiaCoreWindow alloc] initWithContentRect:NSMakeRect(0, 0, 960, 620)];
    _core.delegate = self;
  }
  [_core prepareProfile:profile];
  _core.activeProfile = profile;
  ArdiaCoreTab *previous = _tab;
  _opening = YES;
  if (adopted) {
    [_core adoptTab:adopted];
    _tab = adopted;
  } else
    _tab = [_core openTab:url.length ? url : @"about:blank" profile:profile foreground:YES];
  _opening = NO;
  _tab.delegate = self;
  NSView *host = _core.hostView;
  _tab.view.frame = host.bounds;
  _tab.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [host addSubview:_tab.view];
  [_tab noteShownByHost:YES];
  [_core activateTab:_tab];
  if (previous) {
    previous.delegate = nil;
    [previous.view removeFromSuperview];
    [previous closeNow];
  }
  if (first) {
    NSWindow *window = _core.window;
    window.title = @"Mini Wing";
    window.minSize = NSMakeSize(420, 300);
    window.toolbarStyle = NSWindowToolbarStyleUnifiedCompact;
    window.titleVisibility = NSWindowTitleHidden;
    NSToolbar *toolbar = [[NSToolbar alloc] initWithIdentifier:@"WingMiniToolbar"];
    toolbar.delegate = self;
    toolbar.displayMode = NSToolbarDisplayModeIconOnly;
    window.toolbar = toolbar;
    [window center];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    if (!url.length && !adopted) [window makeFirstResponder:_address];
  }
  [self refresh];
}

#pragma mark Toolbar

- (NSArray<NSToolbarItemIdentifier> *)toolbarDefaultItemIdentifiers:(NSToolbar *)toolbar {
  return @[ @"back", @"forward", @"address", @"profile", @"expand" ];
}
- (NSArray<NSToolbarItemIdentifier> *)toolbarAllowedItemIdentifiers:(NSToolbar *)toolbar {
  return [self toolbarDefaultItemIdentifiers:toolbar];
}
- (NSToolbarItem *)button:(NSString *)identifier
                   symbol:(NSString *)symbol
                    label:(NSString *)label
                   action:(SEL)action {
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  item.image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:label];
  item.label = label;
  item.toolTip = label;
  item.bordered = YES;
  item.target = self;
  item.action = action;
  return item;
}
- (NSToolbarItem *)toolbar:(NSToolbar *)toolbar
        itemForItemIdentifier:(NSToolbarItemIdentifier)identifier
    willBeInsertedIntoToolbar:(BOOL)flag {
  if ([identifier isEqual:@"back"])
    return _back = [self button:identifier symbol:@"chevron.left" label:@"Back" action:@selector(goBack:)];
  if ([identifier isEqual:@"forward"])
    return _forward = [self button:identifier symbol:@"chevron.right" label:@"Forward" action:@selector(goForward:)];
  if ([identifier isEqual:@"expand"])
    return _expand = [self button:identifier
                           symbol:@"arrow.up.left.and.arrow.down.right"
                            label:@"Open in Wing"
                           action:@selector(expand:)];
  NSToolbarItem *item = [[NSToolbarItem alloc] initWithItemIdentifier:identifier];
  if ([identifier isEqual:@"profile"]) {
    _profile = [NSPopUpButton new];
    _profile.bezelStyle = NSBezelStyleToolbar;
    for (NSDictionary *space in _spaces) {
      NSString *title = [NSString stringWithFormat:@"%@ %@", space[@"icon"] ?: @"", space[@"name"] ?: @""];
      [_profile addItemWithTitle:[title stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet]];
      _profile.lastItem.representedObject = space[@"id"];
      if ([space[@"id"] isEqual:_spaceId]) [_profile selectItem:_profile.lastItem];
    }
    _profile.target = self;
    _profile.action = @selector(chooseProfile:);
    [_profile.widthAnchor constraintLessThanOrEqualToConstant:120].active = YES;
    _profile.toolTip = @"Open in profile";
    item.view = _profile;
    item.label = @"Profile";
    return item;
  }
  _address = [NSTextField new];
  _address.placeholderString = @"Search or enter website";
  _address.bezelStyle = NSTextFieldRoundedBezel;
  _address.font = [NSFont systemFontOfSize:12];
  _address.cell.scrollable = YES;
  _address.cell.usesSingleLineMode = YES;
  _address.target = self;
  _address.action = @selector(go:);
  _address.delegate = self;
  [_address.widthAnchor constraintGreaterThanOrEqualToConstant:140].active = YES;
  NSLayoutConstraint *preferred = [_address.widthAnchor constraintEqualToConstant:280];
  preferred.priority = NSLayoutPriorityDefaultLow;
  preferred.active = YES;
  item.view = _address;
  item.label = @"Address";
  return item;
}

#pragma mark Actions

- (NSString *)visibleURL {
  NSString *url = _tab.url ?: @"";
  return [url isEqual:@"about:blank"] ? @"" : url;
}
- (NSString *)resolve:(NSString *)input {
  NSString *value = [input stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  NSURL *url = [NSURL URLWithString:value];
  if ([@[ @"http", @"https" ] containsObject:url.scheme.lowercaseString] && url.host.length)
    return url.absoluteString;
  NSRegularExpression *host = [NSRegularExpression
      regularExpressionWithPattern:@"^(localhost|[\\w-]+(\\.[\\w-]+)+)(:\\d+)?(/\\S*)?$"
                           options:NSRegularExpressionCaseInsensitive
                             error:nil];
  if (![value containsString:@" "] &&
      [host numberOfMatchesInString:value options:0 range:NSMakeRange(0, value.length)])
    return [([value hasPrefix:@"localhost"] ? @"http://" : @"https://") stringByAppendingString:value];
  NSString *query = [value stringByAddingPercentEncodingWithAllowedCharacters:
                               NSCharacterSet.URLQueryAllowedCharacterSet];
  query = [query stringByReplacingOccurrencesOfString:@"&" withString:@"%26"];
  query = [query stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"];
  return [_search stringByAppendingString:query ?: @""];
}
- (void)go:(id)sender {
  if (!_address.stringValue.length) return;
  [_tab loadURL:[self resolve:_address.stringValue] userInitiated:YES];
  [_core.window makeFirstResponder:nil];
  [_tab focus];
}
- (void)goBack:(id)sender { [_tab goBack]; }
- (void)goForward:(id)sender { [_tab goForward]; }
- (void)chooseProfile:(id)sender {
  NSString *chosen = _profile.selectedItem.representedObject;
  if (!chosen || [chosen isEqual:_spaceId]) return;
  // A page cannot change profile, so reopen it in the new one.
  NSString *url = [self visibleURL];
  _spaceId = chosen;
  _lastVisit = nil;
  [self loadPage:url adopting:nil];
}
- (void)expand:(id)sender {
  NSString *url = [self visibleURL];
  if (!url.length) return;
  _expandHandler(url, _spaceId);
  [_core.window performClose:nil];
}

+ (BOOL)performMenuAction:(NSString *)name args:(NSDictionary *)args {
  if (!NSApp.keyWindow) return NO;
  for (WingMiniWindow *mini in gMinis)
    if (mini->_core.window == NSApp.keyWindow) {
      [mini perform:name];
      return YES;
    }
  return NO;
}
- (void)perform:(NSString *)name {
  if ([name isEqual:@"close-tab"])
    [_core.window performClose:nil];
  else if ([name isEqual:@"palette-navigate"]) {
    [_core.window makeFirstResponder:_address];
    [_address selectText:nil];
  } else if ([name isEqual:@"reload"])
    [_tab reload];
  else if ([name isEqual:@"back"])
    [_tab goBack];
  else if ([name isEqual:@"forward"])
    [_tab goForward];
}

#pragma mark State

- (void)refresh {
  if (_closing) return;
  NSString *url = [self visibleURL];
  _core.window.title = _tab.title.length && url.length ? _tab.title : @"Mini Wing";
  _back.enabled = _tab.canGoBack;
  _forward.enabled = _tab.canGoForward;
  _expand.enabled = url.length > 0;
  if (!_address.currentEditor) _address.stringValue = url;
}
- (void)tabDidChangeTitle:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeURL:(ArdiaCoreTab *)tab {
  [self refresh];
  NSString *url = [self visibleURL];
  if (tab == _tab && [url hasPrefix:@"http"] && ![url isEqual:_lastVisit]) {
    _lastVisit = url;
    _visit(url, tab.title ?: @"", _spaceId);
  }
}
- (void)tabDidChangeLoading:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabDidChangeNavigationState:(ArdiaCoreTab *)tab { [self refresh]; }
- (void)tabWillClose:(ArdiaCoreTab *)tab {
  if (tab == _tab && !_closing) [_core.window performClose:nil];
}

#pragma mark Window

- (void)window:(ArdiaCoreWindow *)window
    didInsertTab:(ArdiaCoreTab *)tab
          opener:(ArdiaCoreTab *)opener
     disposition:(NSString *)disposition {
  if (_opening || tab == _tab) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (tab.closed || self->_closing) return;
    for (WingMiniWindow *mini in gMinis)
      if (mini->_tab == tab) return;
    // A page that keeps opening windows gets its extras closed, not a flood.
    if (gMinis.count >= 20) {
      [tab closeNow];
      return;
    }
    WingMiniWindow *mini = [WingMiniWindow new];
    mini->_spaces = self->_spaces;
    mini->_spaceId = self->_spaceId;
    mini->_search = self->_search;
    mini->_loader = self->_loader;
    mini->_expandHandler = self->_expandHandler;
    mini->_visit = self->_visit;
    [gMinis addObject:mini];
    [mini attachProfile:tab.profile url:nil adopting:tab];
  });
}

- (BOOL)window:(ArdiaCoreWindow *)window preHandleKeyEvent:(NSEvent *)event {
  if (event.type != NSEventTypeKeyDown) return NO;
  NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
  if (flags == (NSEventModifierFlagCommand | NSEventModifierFlagShift) &&
      [event.charactersIgnoringModifiers.lowercaseString isEqual:@"r"]) {
    [_tab reloadIgnoringCache];
    return YES;
  }
  if (flags != NSEventModifierFlagCommand) return NO;
  NSDictionary *actions = @{
    @"l" : @"palette-navigate",
    @"w" : @"close-tab",
    @"r" : @"reload",
    @"[" : @"back",
    @"]" : @"forward"
  };
  NSString *name = actions[event.charactersIgnoringModifiers.lowercaseString];
  if (!name) return NO;
  [self perform:name];
  return YES;
}

- (BOOL)windowShouldClose:(ArdiaCoreWindow *)window {
  if (_closing) return YES;
  _closing = YES;
  _tab.delegate = nil;
  [_tab closeNow];
  [gMinis removeObject:self];
  return YES;
}
@end
