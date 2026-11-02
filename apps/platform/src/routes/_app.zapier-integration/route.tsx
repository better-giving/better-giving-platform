import { AlertCircle } from "lucide-react";
import { apex_domain } from "@/constants";
import { emails } from "@/constants/common";
import type { Route } from "./+types/route";

export const headers: Route.HeadersFunction = () => ({
  "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
});

export default function Component() {
  return (
    <div className="page">
      <div className="p-4 sm:p-6 border-b">
        <h1 className="text-xl sm:text-2xl font-bold text-primary">
          Using the Better Giving - Zapier Integration
        </h1>
      </div>
      <div className="p-4 sm:p-6">
        <ol className="space-y-6 sm:space-y-8 list-none">
          {steps.map((step, index) => (
            <li
              key={index}
              className="flex flex-col sm:flex-row sm:items-start gap-4"
            >
              <div className="shrink-0 size-6 rounded-full bg-secondary flex items-center justify-center text-primary font-bold">
                {index + 1}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-medium">{step.title}</h3>
                <div className="mt-2  space-y-4">{step.content}</div>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-8 p-4 bg-gray-3 border-l-4 border-primary rounded-r">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="shrink-0">
              <AlertCircle className="icon-xl text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-primary">
                Questions? Need assistance?
              </h3>
              <p className="mt-1 text-sm">
                If you need any additional support, please reach out to{" "}
                <a href={`mailto:${emails.hi}`} className="link">
                  {emails.hi}
                </a>
                .
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const steps = [
  {
    title: "Login to your Zapier Account",
    content: (
      <p>
        Don&apos;t have Zapier yet?{" "}
        <a href="https://zapier.com/sign-up/" className="link">
          Create a new account
        </a>
        .
      </p>
    ),
  },
  {
    title: "Get your API key from Better Giving",
    content: (
      <>
        <p>
          <a href={`https://${apex_domain}`} className="link">
            Go to your Better Giving NPO dashboard
          </a>{" "}
          and navigate to the API section to find your API key.
        </p>
        <div className="p-4 bg-warning-subtle border-l-4 border-warning rounded-r">
          <h4 className="text-sm font-medium text-warning-subtle-fg">
            Important
          </h4>
          <p className="mt-1 text-sm text-warning-subtle-fg">
            Keep your API key secure. Do not share it with anyone who
            shouldn&apos;t have access to your Better Giving account.
          </p>
        </div>
      </>
    ),
  },
  {
    title: "Create new Zap",
    content: <p>From your Zapier dashboard, click on the Create Zap button.</p>,
  },
  {
    title: "Select the Trigger",
    content: (
      <>
        <p>Search for the Better Giving app and click on it.</p>
        <p>We support the following trigger:</p>
        <ul className="list-disc list-inside ml-4">
          <li>New donation is made</li>
        </ul>
        <p>Select the trigger and press continue.</p>
        <p>To connect to Better Giving, click Sign in with API Key.</p>
        <p>
          Enter the API key you obtained from your Better Giving NPO dashboard
          and click Yes, Continue.
        </p>
        <button type="button" className="mt-2 btn btn-primary w-full sm:w-auto">
          Continue
        </button>
        <p>Click Test trigger button.</p>
        <p>When the trigger is tested successfully, press Continue.</p>
      </>
    ),
  },
];
