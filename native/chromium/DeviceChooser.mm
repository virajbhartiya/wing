#import "DeviceChooser.h"
@implementation WingDeviceChooser {
  NSWindow *_window;
  NSAlert *_alert;
  NSPopUpButton *_devices;
  NSButton *_refresh, *_settings;
  NSArray *_options;
  NSString *_origin;
  int _identity;
  BOOL _finished, _started, _allowEmpty;
}
@synthesize tab = _tab;
- (instancetype)initWithTab:(ArdiaCoreTab *)tab window:(NSWindow *)window {
  if ((self = [super init])) {
    _tab = tab;
    _window = window;
    _origin = tab.committedOrigin;
    _alert = [NSAlert new];
    [_alert addButtonWithTitle:@"Cancel"];
    [_alert addButtonWithTitle:@"Connect"];
    NSView *accessory = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 360, 86)];
    _devices = [[NSPopUpButton alloc] initWithFrame:NSMakeRect(0, 46, 360, 30) pullsDown:NO];
    _devices.target = self;
    _devices.action = @selector(selectionChanged:);
    _devices.accessibilityLabel = @"Available devices";
    _refresh = [NSButton buttonWithTitle:@"Scan again" target:self action:@selector(refresh:)];
    _refresh.frame = NSMakeRect(0, 4, 116, 30);
    _settings = [NSButton buttonWithTitle:@"Open device settings" target:self action:@selector(settings:)];
    _settings.frame = NSMakeRect(130, 4, 220, 30);
    for (NSView *view in @[_devices, _refresh, _settings]) [accessory addSubview:view];
    _alert.accessoryView = accessory;
  }
  return self;
}
- (BOOL)requestStillValid {
  return !_finished && !_tab.closed && [_origin isEqual:_tab.committedOrigin];
}
- (void)update:(NSDictionary *)state {
  if (_finished) return;
  _identity = [state[@"id"] intValue];
  if (![state[@"open"] boolValue]) { [self finish:NO]; return; }
  if (![self requestStillValid]) { [self cancel]; return; }
  _alert.messageText = state[@"title"] ?: @"Choose a device";
  NSString *status = [state[@"unauthorized"] boolValue] ? @"Device access needs permission in macOS settings."
      : [state[@"adapterOff"] boolValue] ? @"Turn on the device adapter to continue."
      : [state[@"refreshing"] boolValue] ? (state[@"scanningText"] ?: @"Looking for devices…")
      : [state[@"options"] count] ? @"Choose the device you want to share with this website."
      : (state[@"noOptionsText"] ?: @"No devices found.");
  _alert.informativeText = [NSString stringWithFormat:@"%@\n%@", _origin ?: @"", status];
  _alert.buttons[0].title = state[@"cancelLabel"] ?: @"Cancel";
  _alert.buttons[1].title = state[@"okLabel"] ?: @"Connect";
  NSArray *options = state[@"options"] ?: @[];
  if (![_options isEqual:options]) {
    _options = [options copy];
    [_devices removeAllItems];
    [_devices addItemWithTitle:@"Choose a device…"];
    _devices.itemArray[0].enabled = NO;
    // Device names need not be unique. Add menu items directly so duplicate
    // labels cannot be coalesced and change Chromium's selection indices.
    for (NSDictionary *option in options) {
      NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:option[@"name"] ?: @"Device"
                                                  action:nil keyEquivalent:@""];
      [_devices.menu addItem:item];
    }
    [_devices selectItemAtIndex:0]; // A changed device list requires a fresh user selection.
  }
  _allowEmpty = [state[@"bothButtonsEnabled"] boolValue];
  _refresh.hidden = ![state[@"canRefresh"] boolValue];
  _refresh.enabled = ![state[@"refreshing"] boolValue];
  _settings.hidden = ![state[@"unauthorized"] boolValue] && ![state[@"adapterOff"] boolValue];
  [self selectionChanged:nil];
  if (_started) return;
  _started = YES;
  [_alert beginSheetModalForWindow:_window completionHandler:^(NSModalResponse response) {
    if (self->_finished) return;
    int index = (int)self->_devices.indexOfSelectedItem - 1;
    BOOL accept = response == NSAlertSecondButtonReturn && [self requestStillValid] &&
      ((index >= 0 && index < self->_options.count) || self->_allowEmpty);
    [self finish:NO];
    if (accept) [ArdiaCoreEngine selectDevice:self->_identity index:index];
    else [ArdiaCoreEngine cancelDeviceChooser:self->_identity];
  }];
}
- (void)selectionChanged:(id)sender {
  _alert.buttons[1].enabled = [self requestStillValid] && (_devices.indexOfSelectedItem > 0 || _allowEmpty);
}
- (void)refresh:(id)sender { if ([self requestStillValid]) [ArdiaCoreEngine refreshDeviceChooser:_identity]; }
- (void)settings:(id)sender { if ([self requestStillValid]) [ArdiaCoreEngine openDeviceChooserSettings:_identity]; }
- (void)finish:(BOOL)cancel {
  if (_finished) return;
  _finished = YES;
  if (_alert.window.sheetParent) [_window endSheet:_alert.window returnCode:NSModalResponseCancel];
  if (cancel) [ArdiaCoreEngine cancelDeviceChooser:_identity];
  if (self.onClose) self.onClose();
  _tab = nil;
}
- (void)cancel { [self finish:YES]; }
@end
