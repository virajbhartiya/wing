#import <AppKit/AppKit.h>
@class ArdiaCoreProfile, ArdiaCoreTab;
NS_ASSUME_NONNULL_BEGIN
// A small floating window for a quick look, like Little Arc. It holds one page
// in a chosen profile until the user moves it into a tab.
typedef void (^WingMiniProfileLoader)(NSString *profileId,
                                      void (^ready)(ArdiaCoreProfile *_Nullable profile));
// Hands over the live page, when there is one, so it keeps its state.
typedef void (^WingMiniExpand)(NSString *url, NSString *spaceId, ArdiaCoreTab *_Nullable page);
typedef void (^WingMiniVisit)(NSString *url, NSString *title, NSString *spaceId);
@interface WingMiniWindow : NSObject
+ (void)openURL:(nullable NSString *)url
         spaces:(NSArray<NSDictionary *> *)spaces
        spaceId:(NSString *)spaceId
         search:(NSString *)searchPrefix
         loader:(WingMiniProfileLoader)loader
         expand:(WingMiniExpand)expand
          visit:(WingMiniVisit)visit;
// Keeps app menu actions from reaching the main window behind a key mini window.
+ (BOOL)performMenuAction:(NSString *)name args:(NSDictionary *)args;
+ (NSUInteger)openCount;
+ (NSArray<NSDictionary *> *)diagnostics;
+ (void)closeAll;
// Qualification only: presses Open in Wing on the first mini window.
+ (void)expandFirst;
@end
NS_ASSUME_NONNULL_END
