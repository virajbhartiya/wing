#import <Foundation/Foundation.h>
NS_ASSUME_NONNULL_BEGIN
typedef void (^WingImportReply)(id _Nullable result, NSString *_Nullable error);
typedef void (^WingImportRequest)(NSDictionary *request, WingImportReply reply);
@interface WingImportProcess : NSObject
- (void)start:(NSDictionary *)input
       request:(WingImportRequest)request
    completion:(WingImportReply)completion;
- (void)stop;
@end

NS_ASSUME_NONNULL_END
