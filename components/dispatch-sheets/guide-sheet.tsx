import { SheetShell } from "./sheet-shell";
import { RowButtons } from "./work-sheet";

/**
 * Guide Sheet 派导游单（Annie 2026-10-03）：版式跟 Work Sheet 同一套，栏目照导游要用的。
 * 栏目名英文（Annie 定），内容随便填什么语言。导游工资不放在单子上（单子会交到导游手上）。
 * 格子照旧页面 admin/guide_sheet.html，id 不能改（草稿和 Save file 的文件按 id 认格子）。
 */
const ITIN_ROWS = Array.from({ length: 16 }, (_, i) => i);
const TICKET_ROWS = [0, 1, 2];
const LOG_CELLS = [
  "d1_start",
  "d1_finish",
  "d1_ot",
  "d1_sign",
  "d2_start",
  "d2_finish",
  "d2_ot",
  "d2_sign",
];

export function GuideSheet() {
  return (
    <SheetShell sheetId="guide" title="Guide Sheet" howto={<HowTo />}>
      <div className="ws-head">
        <div className="ws-badge">Guide Ticket</div>
        <div className="ws-co">
          <input
            className="co-name"
            id="co_name"
            defaultValue="CHD Inc."
            placeholder="Company name"
          />
          <input className="ln" id="co_addr1" placeholder="Street address" />
          <input className="ln" id="co_addr2" placeholder="City, State ZIP" />
          <div className="gs-co-line">
            <span>Tel No:</span>
            <input id="co_tel" />
          </div>
          <div className="gs-co-line">
            <span>E-mail:</span>
            <input id="co_email" />
          </div>
        </div>
      </div>

      <div className="ws-row2">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">Agency</div>
            <div className="ln">Contact</div>
            <div className="ln">Tel No</div>
            <div className="ln">Ref No</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln" id="agency" />
            <input className="ln" id="agency_contact" />
            <input className="ln" id="agency_tel" />
            <input className="ln" id="agency_ref" />
          </div>
        </div>
        <div className="ws-pair">
          <div className="ws-box lbl w-b">
            <div className="ln">Tour</div>
            <div className="ln">Dates</div>
            <div className="ln">Adults</div>
            <div className="ln">Children</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln bold" id="tour" />
            <input className="ln" id="dates" />
            <input className="ln" id="adults" />
            <input className="ln" id="children" />
          </div>
        </div>
      </div>

      <div className="ws-row2">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">Guide</div>
            <div className="ln">Guide Tel</div>
            <div className="ln">Language</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln bold" id="guide" />
            <input className="ln" id="guide_tel" />
            <input className="ln" id="language" />
          </div>
        </div>
        <div className="ws-pair">
          <div className="ws-box lbl w-b">
            <div className="ln">Meeting Point</div>
            <div className="ln">Meeting Time</div>
            <div className="ln">Vehicle / Driver</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln" id="meet_point" />
            <input className="ln" id="meet_time" />
            <input className="ln" id="vehicle" />
          </div>
        </div>
      </div>

      <div className="ws-bar cols-it">
        <div>Date</div>
        <div>Time</div>
        <div>Item</div>
        <div>Notes</div>
        <RowButtons table="it" />
      </div>
      <div className="ws-itin" data-rows="it" data-min="16">
        {ITIN_ROWS.map((i) => (
          <div key={i} className="row">
            <input id={`it${i}_date`} />
            <input id={`it${i}_time`} />
            <input id={`it${i}_item`} />
            <input id={`it${i}_note`} />
          </div>
        ))}
      </div>

      <div className="ws-bar cols-2">
        <div>Booked Tickets</div>
        <div>Pay on Site (guest pays)</div>
        <RowButtons table="tk" />
      </div>
      <div className="gs-tix">
        <div className="booked" data-rows="tk" data-min="3">
          <div className="h">Item</div>
          <div className="h">Confirmation</div>
          <div className="h">Check-in</div>
          {TICKET_ROWS.flatMap((i) => [
            <input key={`${i}i`} id={`tk${i}_item`} />,
            <input key={`${i}c`} id={`tk${i}_conf`} />,
            <input key={`${i}k`} id={`tk${i}_checkin`} />,
          ])}
        </div>
        <textarea id="pay_on_site" />
      </div>

      <div className="ws-row2 gs-terms">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">Service Hours</div>
            <div className="ln">Overtime Rate</div>
            <div className="ln">Service Ends</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln" id="svc_hours" />
            <input className="ln" id="overtime" />
            <input className="ln" id="svc_ends" />
          </div>
        </div>
        <div className="ws-pair">
          <div className="ws-box lbl w-b">
            <div className="ln">Notes</div>
          </div>
          <div className="ws-box val slim notes">
            <textarea id="notes" />
          </div>
        </div>
      </div>

      <div className="gs-fill" />

      <div className="ws-printed">
        <input id="printed" placeholder="Printed: date / time" />
      </div>
      <div className="ws-log gs-log">
        <div className="col">
          <div className="ws-box lbls h1">&nbsp;</div>
          <div
            className="ws-box lbls"
            style={{ flex: 1, justifyContent: "space-around" }}
          >
            <div>Day 1</div>
            <div>Day 2</div>
          </div>
        </div>
        <div className="col">
          <div className="ws-box cells h1">
            <div>Actual Start</div>
            <div>Actual Finish</div>
            <div>Overtime Hrs</div>
            <div>Guide Signature</div>
          </div>
          <div className="ws-box cells two" style={{ flex: 1 }}>
            {LOG_CELLS.map((k) => (
              <div key={k}>
                <input id={k} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </SheetShell>
  );
}

function HowTo() {
  return (
    <details className="howto-d">
      <summary>📖 How to use — Guide Sheet</summary>
      <ol>
        <li>
          Click a yellow box on the sheet and type. Leave a box empty if you do
          not need it. You can type in any language.
        </li>
        <li>
          In the itinerary, write the date only on the first row of each day.
          Use Notes for the address, tickets or what the guide should check.
        </li>
        <li>
          Put prepaid tickets under Booked Tickets with the confirmation number
          and check-in time. Put tickets the guests buy themselves under Pay on
          Site.
        </li>
        <li>
          A box turns red when the text is longer than the box. Drag its edge
          wider, or shorten the text, or the end will be cut off on the PDF.
        </li>
        <li>
          To change a width, point at the edge of a box (a thin blue bar shows
          up) and drag left or right. Click Reset widths to go back to the
          original widths.
        </li>
        <li>
          To add a line, click + Row at the right end of the Date / Time / Item
          / Notes bar, or of the Booked Tickets bar. Click - Row to remove the
          last row when it is empty.
        </li>
        <li>
          If the rows no longer fit on one page, a note at the top says how many
          pages the PDF will have.
        </li>
        <li>
          Click Save as PDF. In the print window choose Save as PDF, paper A4,
          and tick Background graphics. Then click Save. Send the PDF to the
          guide.
        </li>
        <li>
          To keep a sheet and change it later, click Save file. Next time click
          Open file and pick that file. A file saved on the old admin page opens
          here too.
        </li>
        <li>
          To start a new sheet, click Clear all twice. It keeps the CHD Inc.
          lines at the top. Nothing is saved in the system.
        </li>
      </ol>
    </details>
  );
}
