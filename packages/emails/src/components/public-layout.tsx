import { EIN, LEGAL_NAME } from "@better-giving/brand";
import { flat_colors } from "@better-giving/brand/flat";
import type { PropsWithChildren, ReactNode } from "react";
import { Body, Container, Head, Html, Section, Text } from "react-email";
import { APP_NAME } from "../constants";
import { Hr } from "./hr";
import { SocialLinks } from "./social-links";

export type PublicLayoutProps = PropsWithChildren<{
  type?: "registration" | "donation" | "fund";
  bottom_content?: ReactNode;
}>;

export function PublicLayout({
  children,
  type,
  bottom_content,
}: PublicLayoutProps) {
  return (
    <Html lang="en">
      <Head>
        <title>{`Email from ${APP_NAME}`}</title>
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
          <Section>
            {children}
            {type !== "donation" && (
              <>
                <Text style={{ margin: 0 }}>
                  {type === "fund" ? "Best" : "Warm"} regards,
                </Text>
                <Text
                  style={{
                    margin: 0,
                    fontWeight: 600,
                    color: flat_colors.primary,
                  }}
                >
                  The {APP_NAME} Team
                </Text>
              </>
            )}
          </Section>
          <Hr />
          <SocialLinks />

          {type === "registration" && (
            <Text style={{ textAlign: "center", margin: 0, marginTop: 4 }}>
              You received this email because you have registered your
              organization with us.
            </Text>
          )}

          <Text
            style={{
              textAlign: "center",
              margin: 0,
              marginTop: 4,
              fontSize: 13,
              color: flat_colors.gray_11,
            }}
          >
            {LEGAL_NAME} | EIN: {EIN} | Copyright {new Date().getUTCFullYear()}{" "}
            All Rights reserved.
          </Text>
          {bottom_content}
        </Container>
      </Body>
    </Html>
  );
}
