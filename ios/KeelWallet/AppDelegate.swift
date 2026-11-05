import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

/**
 * Xcode 27 / the iOS 27 SDK REFUSE to launch an app that still puts its
 * window up from the app delegate (2026-09-18: every launch died instantly in
 * `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`). React
 * Native 0.86 ships no scene delegate of its own, so the app owns one here.
 *
 * The split: the app delegate still builds React Native's factory once, and
 * the scene delegate owns the window and starts React Native inside it. The
 * deep links (tiam://) are the part that breaks quietly under scenes, because
 * `application(_:open:)` is never called any more. They arrive in two new
 * places instead, and both are forwarded below: a link that LAUNCHES the app
 * comes in the scene's connection options, and a link that arrives while it
 * runs comes through `scene(_:openURLContexts:)`.
 */
@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?
  /** Kept for the scene, which is what actually starts React Native. */
  var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    self.launchOptions = launchOptions

    return true
  }

  // Still here for anything that predates the scene life cycle. Under scenes
  // iOS calls the scene delegate instead, so this is simply never reached.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }
}

/** Named for the Info.plist without a module prefix, so renaming the target
 *  can never leave the app with no scene delegate and no way to launch. */
@objc(SceneDelegate)
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let appDelegate = UIApplication.shared.delegate as? AppDelegate
    let window = UIWindow(windowScene: windowScene)
    self.window = window

    appDelegate?.reactNativeFactory?.startReactNative(
      withModuleName: "KeelWallet",
      in: window,
      launchOptions: appDelegate?.launchOptions
    )

    // A link that LAUNCHED the app lands here, not in the app delegate.
    for context in connectionOptions.urlContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // A link that arrives while the app is already running.
  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      RCTLinkingManager.application(UIApplication.shared, open: context.url, options: [:])
    }
  }

  // THE APP-SWITCHER PICTURE (decided 2026-09-26). Two
  // pictures of the app can show balances and QR codes outside it:
  //   - while Talia is only INACTIVE (a swipe up into the app switcher, the
  //     notification shade, Control Centre, a system sheet), the switcher
  //     card shows the LIVE window (decided 2026-09-30: covering only in the
  //     background left that card showing balances);
  //   - as it reaches the background, iOS photographs the window for the
  //     switcher and keeps that picture on disk.
  // So the launch screen covers the window from the moment the app resigns
  // active, and again (a safety net) as it enters the background, and comes
  // off once the app is in front again. The cover also shows behind the Face
  // ID sheet, which makes the app inactive too; that is the price of a card
  // that never shows the vaults. The JavaScript lock (AuthGate) decides
  // separately whether coming back asks for Face ID or the PIN.
  private var privacyCover: UIView?

  private func coverWindow() {
    guard let window = window, privacyCover == nil else { return }
    let launch = UIStoryboard(name: "LaunchScreen", bundle: nil)
      .instantiateInitialViewController()?.view
    let cover = launch ?? UIView()
    if launch == nil {
      cover.backgroundColor = window.rootViewController?.view.backgroundColor ?? .black
    }
    cover.frame = window.bounds
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.accessibilityViewIsModal = true // VoiceOver reads nothing behind it
    window.addSubview(cover)
    privacyCover = cover
  }

  func sceneWillResignActive(_ scene: UIScene) {
    coverWindow()
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    coverWindow()
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    privacyCover?.removeFromSuperview()
    privacyCover = nil
  }

  // Universal links and Handoff, whether or not we use them today: under
  // scenes they stop reaching the app delegate as well.
  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    RCTLinkingManager.application(
      UIApplication.shared,
      continue: userActivity,
      restorationHandler: { _ in }
    )
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
