import { flat_colors } from "@better-giving/brand/flat";
import type { PropsWithChildren } from "react";
import { Body, Container, Head, Html, Section } from "react-email";
import { APP_NAME } from "../constants";

export type PlatformLayoutProps = PropsWithChildren<{
  /** document title. pass the inbox subject when the file should carry it */
  title?: string;
}>;

export function PlatformLayout({
  children,
  title = `Email from ${APP_NAME}`,
}: PlatformLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <title>{title}</title>
      </Head>
      <Body
        style={{
          fontFamily: "sans-serif",
          // the ramp step, not --background: mail keeps the gray-1 ground the
          // app moved off when its page went white.
          backgroundColor: flat_colors.gray_1,
          // explicit ink: clients that force dark mode invert inherited text
          // while still honouring an explicit background — white on white.
          color: flat_colors.gray_12,
        }}
      >
        <Container style={{ padding: 16 }}>
          <Section>{children}</Section>
        </Container>
      </Body>
    </Html>
  );
}
