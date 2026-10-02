import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'VideoBuddy · 边聊边做视频', description: '聊想法，发资料，先看效果，再做视频。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
