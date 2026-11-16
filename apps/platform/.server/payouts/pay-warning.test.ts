import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const send_alert = vi.hoisted(() => vi.fn());
const report_error = vi.hoisted(() => vi.fn());

vi.mock("../env", () => ({ stage: "test" }));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("../kit/slack", () => ({ aws_monitor: { send_alert } }));

const { attach_warning, send_pay_warning, warning_of } = await import(
  "./pay-warning"
);

const warning = {
  title: "payout to one of Better Giving's own Wise accounts",
  body: "the payout went ahead",
  fields: [{ name: "recipient", value: "881063184" }],
};

beforeEach(() => {
  send_alert.mockReset().mockResolvedValue(undefined);
  report_error.mockReset();
});

describe("send_pay_warning", () => {
  test("sends the warning as an ERROR from wise-pay", async () => {
    await send_pay_warning(warning);

    expect(send_alert).toHaveBeenCalledWith({
      ...warning,
      type: "ERROR",
      from: "wise-pay:test",
    });
  });

  test("sends nothing for no warning", async () => {
    await send_pay_warning(undefined);
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("a rejecting Slack never throws, and is reported", async () => {
    const down = new Error("slack down");
    send_alert.mockRejectedValue(down);

    await expect(send_pay_warning(warning)).resolves.toBeUndefined();

    expect(report_error).toHaveBeenCalledWith(down, { alert: warning.title });
  });

  describe("a stalled Slack", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("is given up on after 3s, and reported", async () => {
      send_alert.mockReturnValue(new Promise(() => {}));

      const sent = send_pay_warning(warning);
      let done = false;
      sent.then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(2_900);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      await sent;

      expect(done).toBe(true);
      expect(report_error).toHaveBeenCalledWith(expect.any(Error), {
        alert: warning.title,
      });
    });
  });
});

describe("attach_warning", () => {
  test("rides on the error object it was attached to", () => {
    const err = new Error("boom");
    attach_warning(err, warning);

    expect(warning_of(err)).toEqual(warning);
    expect(warning_of(new Error("other"))).toBeUndefined();
    expect(send_alert).not.toHaveBeenCalled();
  });

  test("a bare string can carry nothing, so the warning is sent on its own", async () => {
    attach_warning("fetch failed", warning);
    await Promise.resolve();

    expect(send_alert).toHaveBeenCalledOnce();
    expect(warning_of("fetch failed")).toBeUndefined();
  });
});
