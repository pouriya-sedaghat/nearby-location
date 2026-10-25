const assert = require("node:assert/strict");
const test = require("node:test");
const { timeAgo } = require("../dist/helpers/timeAgo.helper");
const now = Date.parse("2026-10-25T12:00:00Z");
const age = (start, end) => timeAgo(new Date(start), Date.parse(end));

test("elapsed units round down with correct singular/plural and boundary transitions", () => {
  for (const [milliseconds, expected] of [[0, "0 seconds ago"], [999, "0 seconds ago"],
    [1000, "1 second ago"], [2000, "2 seconds ago"], [59999, "59 seconds ago"],
    [60000, "1 minute ago"], [119999, "1 minute ago"], [120000, "2 minutes ago"],
    [3599999, "59 minutes ago"], [3600000, "1 hour ago"], [7200000, "2 hours ago"],
    [86399999, "23 hours ago"], [86400000, "1 day ago"], [172800000, "2 days ago"],
    [604799999, "6 days ago"], [604800000, "1 week ago"], [1209600000, "2 weeks ago"]]) {
    assert.equal(timeAgo(new Date(now - milliseconds), now), expected, String(milliseconds));
  }
});

test("complete UTC calendar months handle variable lengths, month ends and leap centuries", () => {
  const cases = [
    ["2025-01-31T12:00:00Z", "2025-02-28T12:00:00Z", "1 month ago"],
    ["2025-01-31T12:00:00Z", "2025-02-28T11:59:59.999Z", "3 weeks ago"],
    ["2024-01-31T12:00:00Z", "2024-02-28T12:00:00Z", "4 weeks ago"],
    ["2024-01-31T12:00:00Z", "2024-02-29T12:00:00Z", "1 month ago"],
    ["2025-03-31T12:00:00Z", "2025-04-30T12:00:00Z", "1 month ago"],
    ["2025-01-31T12:00:00Z", "2025-03-30T12:00:00Z", "1 month ago"],
    ["2025-01-31T12:00:00Z", "2025-03-31T12:00:00Z", "2 months ago"],
    ["1900-01-31T12:00:00Z", "1900-02-28T12:00:00Z", "1 month ago"],
    ["2000-01-31T12:00:00Z", "2000-02-28T12:00:00Z", "4 weeks ago"],
    ["2000-01-31T12:00:00Z", "2000-02-29T12:00:00Z", "1 month ago"],
    ["0099-12-31T12:00:00Z", "0100-01-31T12:00:00Z", "1 month ago"],
  ];
  for (const [start, end, expected] of cases) assert.equal(age(start, end), expected, start + " -> " + end);
});

test("complete years use calendar anniversaries including February 29", () => {
  for (const [start, end, expected] of [
    ["2024-02-29T12:00:00Z", "2025-02-27T12:00:00Z", "11 months ago"],
    ["2024-02-29T12:00:00Z", "2025-02-28T12:00:00Z", "1 year ago"],
    ["2024-02-29T12:00:00Z", "2026-02-28T12:00:00Z", "2 years ago"],
    ["2024-02-29T12:00:00Z", "2028-02-28T12:00:00Z", "3 years ago"],
    ["2024-02-29T12:00:00Z", "2028-02-29T12:00:00Z", "4 years ago"],
    ["2025-01-31T12:00:00Z", "2026-01-30T12:00:00Z", "11 months ago"],
  ]) assert.equal(age(start, end), expected, start + " -> " + end);
});

test("future timestamps preserve zero age instead of negative or future text", () => {
  for (const offset of [1, 60000, 86400000, 20 * 366 * 86400000]) {
    assert.equal(timeAgo(new Date(now + offset), now), "0 seconds ago");
  }
});

test("invalid dates and out-of-range reference times fail instead of emitting NaN text", () => {
  for (const date of [new Date(NaN), new Date(Infinity)]) assert.throws(() => timeAgo(date, now), RangeError);
  for (const reference of [NaN, Infinity, -Infinity, 1e20]) {
    assert.throws(() => timeAgo(new Date(now), reference), RangeError);
  }
});

test("explicit references, epoch zero and offset-equivalent instants are deterministic", () => {
  assert.equal(timeAgo(new Date(-1000), 0), "1 second ago");
  assert.equal(timeAgo(new Date("2026-10-25T15:29:00+03:30"), now), "1 minute ago");
  assert.equal(age("2026-03-07T12:00:00-05:00", "2026-03-08T12:00:00-04:00"), "23 hours ago");
});

test("calendar calculations never mutate the supplied date", () => {
  const date = new Date("2024-02-29T12:00:00.789Z");
  const before = date.getTime();
  assert.equal(timeAgo(date, Date.parse("2025-02-28T12:00:00.789Z")), "1 year ago");
  assert.equal(date.getTime(), before);
});

test("Persian uses native digits and the same elapsed and UTC calendar unit boundaries as English", () => {
  for (const [milliseconds, expected] of [[0, "۰ ثانیه پیش"], [1000, "۱ ثانیه پیش"],
    [120000, "۲ دقیقه پیش"], [3600000, "۱ ساعت پیش"], [86400000, "۱ روز پیش"],
    [604800000, "۱ هفته پیش"]]) {
    assert.equal(timeAgo(new Date(now - milliseconds), now, "fa"), expected);
  }
  assert.equal(timeAgo(new Date("2025-01-31T12:00:00Z"), Date.parse("2025-02-28T12:00:00Z"), "fa"), "۱ ماه پیش");
  assert.equal(timeAgo(new Date("2024-02-29T12:00:00Z"), Date.parse("2026-02-28T12:00:00Z"), "fa"), "۲ سال پیش");
  assert.equal(timeAgo(new Date(now + 1), now, "fa"), "۰ ثانیه پیش");
  assert.throws(() => timeAgo(new Date(NaN), now, "fa"), RangeError);
  assert.throws(() => timeAgo(new Date(now), now, "de"), RangeError);
});
