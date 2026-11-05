/** Minimal typings for react-native-mail (the package ships none). */
declare module 'react-native-mail' {
  interface MailOptions {
    subject?: string;
    recipients?: string[];
    ccRecipients?: string[];
    bccRecipients?: string[];
    body?: string;
    isHTML?: boolean;
    attachments?: Array<{ path: string; type?: string; mimeType?: string; name?: string }>;
  }
  const Mailer: {
    mail(options: MailOptions, callback: (error?: string, event?: string) => void): void;
  };
  export default Mailer;
}
