/* Styles live in a shadow root, isolated from SMU's page styles. */
globalThis.FBSStyles = `
  :host { all: initial; color-scheme: light; font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #182641; }
  *, *::before, *::after { box-sizing: border-box; }
  #fbs-dialog, #fbs-launcher { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: default; opacity: .45; }
  button, input, select { border-radius: 9px; }
  button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline: 3px solid #438dff; outline-offset: 3px; }
  [hidden] { display: none !important; }
  #fbs-launcher { position: fixed; z-index: 2147483646; right: 24px; bottom: 24px; display: flex; align-items: center; gap: 11px; border: 1px solid #516dbe; padding: 13px 19px; background: #17377c; color: white; font-weight: 650; box-shadow: 0 8px 28px #102b5940; }
  #fbs-launcher:hover { background: #234994; }
  .launcher-count { padding: 1px 7px; background: #ffffff25; border-radius: 6px; font-size: 12px; }
  svg { display: block; flex-shrink: 0; }
  #fbs-dialog { padding: 0; width: min(1440px, calc(100vw - 48px)); height: min(920px, calc(100vh - 48px)); max-width: none; max-height: none; margin: auto; border: 1px solid #d4ddeb; border-radius: 18px; background: #f6f8fc; color: #182641; box-shadow: 0 24px 100px #0d23444d; overflow: hidden; }
  #fbs-dialog::backdrop { background: #0b193ca6; backdrop-filter: blur(3px); }
  .shell { height: 100%; display: flex; flex-direction: column; }
  .heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 24px 28px 20px; background: white; }
  .eyebrow { display: flex; align-items: center; gap: 8px; color: #536786; font-size: 11px; font-weight: 750; letter-spacing: 1.6px; text-transform: uppercase; margin-bottom: 4px; }
  .brand-dot { width: 8px; height: 8px; border-radius: 50%; background: #32877f; }
  h1 { font-size: 25px; line-height: 1.25; font-weight: 700; letter-spacing: -.6px; margin: 0; }
  .subtitle { margin: 6px 0 0; font-size: 12px; color: #687991; }
  .heading-actions { display: flex; align-items: center; gap: 9px; }
  .button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 37px; border: 1px solid #dce3ed; background: white; padding: 7px 12px; color: #314762; font-weight: 600; font-size: 12px; white-space: nowrap; }
  .button:hover { background: #edf2fa; border-color: #bdcbe0; }
  .button.primary { background: #183b80; color: white; border-color: #183b80; }
  .button.primary:hover { background: #244d97; }
  .button.icon { width: 36px; padding: 7px; }
  .button.close { border-color: transparent; background: #f2f4f8; margin-left: 4px; font-size: 22px; line-height: 20px; }
  .controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 16px 28px; border-top: 1px solid #eef1f6; border-bottom: 1px solid #e0e6ef; background: white; }
  .navigation { display: flex; align-items: center; gap: 6px; }
  #fbs-range { min-width: 165px; padding: 0 5px; font-weight: 700; font-size: 14px; text-align: center; }
  .spacer { flex: 1; }
  .view-toggle { display: flex; padding: 3px; background: #f0f3f8; border-radius: 9px; }
  .view-toggle button { min-height: 30px; padding: 5px 11px; border: 0; color: #5e6e87; background: transparent; font-weight: 600; font-size: 12px; }
  .view-toggle button[aria-pressed="true"] { background: white; color: #193c7a; box-shadow: 0 1px 3px #1b36521a; }
  .filters { display: flex; align-items: center; gap: 12px; padding: 12px 28px; }
  .search { position: relative; flex: 1; max-width: 370px; }
  .search svg { position: absolute; top: 11px; left: 11px; color: #7e8da5; }
  input[type="search"] { width: 100%; height: 38px; padding: 8px 11px 8px 35px; background: white; border: 1px solid #dce3ed; color: #182641; }
  select { height: 38px; padding: 7px 30px 7px 11px; max-width: 200px; border: 1px solid #dce3ed; background: white; color: #314762; }
  .date-jump { display: flex; align-items: center; gap: 8px; color: #697b96; font-size: 12px; }
  input[type="date"] { width: 142px; padding: 7px 8px; height: 37px; border: 1px solid #dce3ed; color: #314762; background: white; }
  #fbs-count { color: #62748d; font-size: 12px; margin-left: auto; text-align: right; }
  .content-wrap { min-height: 0; flex: 1; position: relative; display: flex; flex-direction: column; margin: 0 28px 16px; border: 1px solid #dfe5ee; border-radius: 12px; background: white; overflow: hidden; }
  #fbs-content { min-height: 0; flex: 1; overflow: auto; scrollbar-color: #c2cedf #f7f9fc; }
  .calendar { min-width: 820px; }
  .calendar-header { display: grid; grid-template-columns: 58px repeat(7, minmax(0, 1fr)); position: sticky; top: 0; z-index: 3; background: white; border-bottom: 1px solid #e3e8f1; }
  .zone { align-self: center; color: #8391a7; text-align: center; font-size: 10px; line-height: 1.5; }
  .day-heading { display: flex; flex-direction: column; gap: 2px; align-items: center; padding: 11px 0; border-left: 1px solid #edf0f5; }
  .day-name { color: #7a8ba4; text-transform: uppercase; font-size: 10px; letter-spacing: 1.1px; font-weight: 700; }
  .day-number { font-size: 19px; font-weight: 650; line-height: 28px; min-width: 28px; text-align: center; }
  .day-heading.is-today .day-number { border-radius: 8px; background: #21498b; color: white; }
  .timeline { display: grid; grid-template-columns: 58px repeat(7, minmax(0, 1fr)); padding-bottom: 18px; }
  .time-labels, .day-column { position: relative; }
  .time-label { position: absolute; right: 9px; transform: translateY(-50%); color: #8391a7; font-size: 10px; font-variant-numeric: tabular-nums; }
  .time-label:first-child { transform: translateY(2px); }
  .day-column { border-left: 1px solid #edf0f5; background: repeating-linear-gradient(to bottom, #e9edf4 0, #e9edf4 1px, transparent 1px, transparent 31px, #f4f6fa 31px, #f4f6fa 32px, transparent 32px, transparent 62px); }
  .day-column.is-today { background-color: #f8faff; }
  .booking-event { position: absolute; overflow: hidden; border: 1px solid var(--event-border); border-left: 3px solid var(--event-accent); border-radius: 7px; background: var(--event-bg); color: var(--event-text); text-align: left; padding: 7px 7px; display: flex; flex-direction: column; gap: 3px; line-height: 1.35; min-height: 25px; }
  .booking-event:hover { filter: brightness(.97); box-shadow: 0 3px 8px #182e531f; z-index: 2; }
  .event-time { font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .event-room { font-size: 11px; font-weight: 750; overflow-wrap: anywhere; }
  .event-person { font-size: 10px; opacity: .8; overflow-wrap: anywhere; }
  .event-status { font-size: 9px; text-transform: uppercase; letter-spacing: .3px; }
  .empty { min-height: 220px; display: flex; align-items: center; justify-content: center; flex-direction: column; padding: 40px; text-align: center; color: #74849d; }
  .empty strong { display: block; margin: 14px 0 4px; color: #344d70; font-size: 16px; }
  .empty p { max-width: 440px; margin: 0 0 13px; }
  .agenda { padding: 20px 24px; }
  .agenda-day { margin: 0 0 22px; }
  .agenda-day h2 { color: #5a6f8e; font-size: 12px; text-transform: uppercase; letter-spacing: .8px; margin: 0 0 9px; }
  .agenda-booking { width: 100%; display: flex; gap: 18px; align-items: center; text-align: left; padding: 14px 16px; margin-bottom: 8px; border: 1px solid var(--event-border); border-left: 4px solid var(--event-accent); color: var(--event-text); background: var(--event-bg); }
  .agenda-time { min-width: 110px; font-size: 12px; font-weight: 650; font-variant-numeric: tabular-nums; }
  .agenda-room { font-weight: 700; font-size: 13px; }
  .agenda-meta { font-size: 11px; opacity: .8; margin-top: 2px; }
  .agenda-status { margin-left: auto; font-size: 11px; }
  #fbs-details { border-top: 1px solid #dfe5ee; padding: 16px 20px; background: #f7f9fe; max-height: 205px; overflow: auto; position: relative; }
  #fbs-details h2 { margin: 0 30px 10px 0; font-size: 15px; }
  .details-close { position: absolute; right: 12px; top: 12px; }
  .detail-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 9px 22px; font-size: 12px; }
  .detail-label { color: #7c8ba3; font-size: 10px; text-transform: uppercase; letter-spacing: .6px; }
  .detail-value { overflow-wrap: anywhere; color: #354e6e; }
  .footer { display: flex; flex-wrap: wrap; gap: 4px 18px; align-items: center; padding: 0 28px 16px; color: #7b8ba2; font-size: 10px; }
  .footer span:last-child { margin-left: auto; }
  #fbs-warnings { margin: 0 28px 10px; padding: 9px 13px; font-size: 11px; background: #fff5db; color: #81602b; border: 1px solid #f2dfb4; border-radius: 8px; max-height: 100px; overflow: auto; }
  #fbs-warnings summary { cursor: pointer; font-weight: 650; }
  #fbs-warnings ul { padding-left: 18px; margin: 5px 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
  #fbs-announcement { font-size: 11px; color: #3b6a66; padding: 0 28px 8px; min-height: 0; }
  #fbs-announcement:empty { display: none; }
  @media (max-width: 900px) { .heading { padding: 18px; } .controls { padding: 12px 18px; } .filters { padding: 12px 18px; flex-wrap: wrap; } .content-wrap { margin: 0 18px 14px; } .footer { padding: 0 18px 14px; } .heading-actions .refresh-text { display: none; } #fbs-count { flex-basis: 100%; text-align: left; margin-left: 0; } .date-jump { display: none; } #fbs-warnings { margin: 0 18px 10px; } }
  @media (max-width: 600px) { #fbs-dialog { width: calc(100vw - 16px); height: calc(100dvh - 16px); border-radius: 12px; } #fbs-launcher { bottom: 16px; right: 16px; } h1 { font-size: 20px; } .heading { gap: 7px; padding: 15px; } .subtitle { display: none; } .heading-actions { gap: 5px; } .heading-actions .button { font-size: 11px; padding: 6px 8px; } .heading-actions .button.close { width: 28px; padding: 4px; } .controls { padding: 10px 15px; } #fbs-range { min-width: 137px; font-size: 12px; } .controls .spacer { display: none; } .filters { padding: 10px 15px; gap: 8px; } .search { max-width: none; min-width: 140px; } select { max-width: 140px; } .content-wrap { margin: 0 10px 12px; } .detail-grid { grid-template-columns: 1fr 1fr; } .agenda { padding: 15px 12px; } .agenda-booking { gap: 8px; padding: 12px 9px; flex-wrap: wrap; } .agenda-time { min-width: 95px; } .agenda-status { display: none; } .footer span:last-child { margin-left: 0; } }
`;
