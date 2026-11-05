// Decided 2026-09-26.
//
// The clipboard library the app uses can only put a string on the general
// pasteboard, where it stays until something replaces it and where Universal
// Clipboard hands it to the owner's Mac and iPad. For a SECRET (the two-factor
// key, recovery codes, an invite code, a descriptor) that is wrong, and the
// only way to ask iOS for better is UIPasteboard's setItems:options:, which
// the library does not expose. This one method does:
//
//   localOnly  YES  = never offered to Universal Clipboard (the Mac, the iPad)
//   expiresIn  N s  = iOS removes it from the pasteboard by itself after N
//                     seconds, even while Talia is suspended
//
// JavaScript reaches it through platform/clipboard.ts `copySecret`, which
// falls back to the ordinary copy when a build does not carry this module.
//
// presentPasteMenu (decided 2026-11-01 after a phone test: a tap on the address
// field did nothing, and people expect the Paste a text field offers) shows
// iOS's own Paste bubble at a point of the window. A field with no text input
// gets none by itself, so a small empty view takes the first responder, offers
// `paste:` alone, and UIEditMenuInteraction draws the bubble. The action must
// stay the system's own: that is what spares the client iOS's "Allow Paste?",
// which the app's own read of the clipboard raises.
#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import <UIKit/UIKit.h>

// A bubble that never appears must still answer.
static const NSTimeInterval kShowPatience = 1.0;
// `paste:` arrived before the bubble began to close on iOS 26.5, but nothing
// promises that order, so the view outlives the close by this much before it
// answers that nothing was pasted.
static const NSTimeInterval kPasteAfterClose = 0.3;

API_AVAILABLE(ios(16.0))
@interface TaliaPasteAnchor : UIView <UIEditMenuInteractionDelegate>
@property (nonatomic, copy, nullable) RCTPromiseResolveBlock answer;
@property (nonatomic) BOOL shown;
- (void)finish:(nullable NSString *)text;
@end

@implementation TaliaPasteAnchor

- (BOOL)canBecomeFirstResponder
{
  return YES;
}

- (BOOL)canPerformAction:(SEL)action withSender:(id)sender
{
  return action == @selector(paste:);
}

- (void)paste:(id)sender
{
  [self finish:UIPasteboard.generalPasteboard.string ?: @""];
}

- (void)editMenuInteraction:(UIEditMenuInteraction *)interaction
    willPresentMenuForConfiguration:(UIEditMenuConfiguration *)configuration
                           animator:(id<UIEditMenuInteractionAnimating>)animator
{
  self.shown = YES;
}

- (void)editMenuInteraction:(UIEditMenuInteraction *)interaction
    willDismissMenuForConfiguration:(UIEditMenuConfiguration *)configuration
                           animator:(id<UIEditMenuInteractionAnimating>)animator
{
  __weak TaliaPasteAnchor *weakSelf = self;
  [animator addCompletion:^{
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kPasteAfterClose * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     [weakSelf finish:nil];
                   });
  }];
}

- (void)finish:(NSString *)text
{
  RCTPromiseResolveBlock answer = self.answer;
  if (!answer) {
    return;
  }
  self.answer = nil;
  [self resignFirstResponder];
  [self removeFromSuperview];
  answer(text ?: (id)[NSNull null]);
}

@end

@interface TaliaPasteboard : NSObject <RCTBridgeModule>
// The window holds a showing anchor; this only finds it again.
@property (nonatomic, weak) UIView *pasteAnchor;
@end

@implementation TaliaPasteboard

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

RCT_EXPORT_METHOD(setSecretString:(NSString *)text
                  localOnly:(BOOL)localOnly
                  expiresInSeconds:(nonnull NSNumber *)seconds)
{
  NSMutableDictionary *options = [NSMutableDictionary dictionary];
  if (localOnly) {
    options[UIPasteboardOptionLocalOnly] = @YES;
  }
  double secs = seconds.doubleValue;
  if (secs > 0) {
    options[UIPasteboardOptionExpirationDate] = [NSDate dateWithTimeIntervalSinceNow:secs];
  }
  [[UIPasteboard generalPasteboard] setItems:@[ @{ @"public.utf8-plain-text" : text ?: @"" } ]
                                     options:options];
}

RCT_EXPORT_METHOD(presentPasteMenu:(double)x
                  y:(double)y
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  if (@available(iOS 16.0, *)) {
    // Only ever one, and the last one still gets its answer.
    [(TaliaPasteAnchor *)self.pasteAnchor finish:nil];

    UIWindow *window = RCTKeyWindow();
    if (!window || !UIPasteboard.generalPasteboard.hasStrings) {
      resolve([NSNull null]);
      return;
    }
    TaliaPasteAnchor *anchor = [[TaliaPasteAnchor alloc] initWithFrame:CGRectMake(x, y, 1, 1)];
    anchor.answer = resolve;
    anchor.userInteractionEnabled = NO;
    [window addSubview:anchor];
    self.pasteAnchor = anchor;
    if (![anchor becomeFirstResponder]) {
      [anchor finish:nil];
      return;
    }
    UIEditMenuInteraction *menu = [[UIEditMenuInteraction alloc] initWithDelegate:anchor];
    [anchor addInteraction:menu];
    [menu presentEditMenuWithConfiguration:[UIEditMenuConfiguration configurationWithIdentifier:nil
                                                                                    sourcePoint:CGPointZero]];
    __weak TaliaPasteAnchor *weakAnchor = anchor;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kShowPatience * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
                     if (!weakAnchor.shown) {
                       [weakAnchor finish:nil];
                     }
                   });
    return;
  }
  resolve([NSNull null]);
}

@end
