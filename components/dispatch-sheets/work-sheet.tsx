import { SheetShell } from "./sheet-shell";

/**
 * Work Sheet 派车单（Annie 2026-10-03）：照 Canyon Coach Lines 的 Work Ticket 版式，抬头换成 CHD Inc.。
 * 格子照旧页面 admin/work_sheet.html，id 不能改（草稿和 Save file 的文件按 id 认格子）。
 */
const ITIN_ROWS = Array.from({ length: 8 }, (_, i) => i);
const LOG_CELLS = [
  "t_start",
  "t_first",
  "t_last",
  "t_finish",
  "o_start",
  "o_first",
  "o_last",
  "o_finish",
];

export function WorkSheet() {
  return (
    <SheetShell sheetId="work" title="Work Sheet" howto={<HowTo />}>
      <div className="ws-head">
        <div className="ws-badge">Work Ticket</div>
        <div className="ws-co">
          <input
            className="co-name"
            id="co_name"
            defaultValue="CHD Inc."
            placeholder="Company name"
          />
          <input className="ln" id="co_addr1" placeholder="Street address" />
          <input className="ln" id="co_addr2" placeholder="City, State ZIP" />
          <input className="ln" id="co_addr3" placeholder="License / CPCN" />
        </div>
      </div>

      <div className="ws-row2">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">Client</div>
            <div className="ln">Department</div>
            <div className="ln">Company</div>
            <div className="ln" />
            <div className="ln" />
            <div className="ln" />
            <div className="ln">Tel No</div>
            <div className="ln">Ref 1</div>
            <div className="ln">Ref 2</div>
          </div>
          <div className="ws-box val slim">
            {[
              "client",
              "dept",
              "company",
              "client_x1",
              "client_x2",
              "client_x3",
              "tel",
              "ref1",
              "ref2",
            ].map((id) => (
              <input key={id} className="ln" id={id} />
            ))}
          </div>
        </div>
        <div className="ws-contact">
          <div className="ws-contact-lines">
            <div className="line">
              <span>Tel No:</span>
              <input id="co_tel" />
            </div>
            <div className="line">
              <span>Fax No:</span>
              <input id="co_fax" />
            </div>
            <div className="gap" />
            <div className="line">
              <span>E-mail:</span>
              <input id="co_email" />
            </div>
            <div className="line">
              <span>Website:</span>
              <input id="co_web" />
            </div>
          </div>
          <div className="ws-pair">
            <div className="ws-box lbl w-b">
              <div className="ln">Emergency Tel</div>
              <div className="ln">Nos</div>
              <div className="ln" />
            </div>
            <div className="ws-box val slim">
              <textarea id="emergency" rows={3} style={{ height: "16.8mm" }} />
            </div>
          </div>
        </div>
      </div>

      <div className="ws-row2">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">Seats</div>
            <div className="ln">Vehicle Type</div>
            <div className="ln">License No</div>
            <div className="ln">Fleet No</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln" id="seats" />
            <input className="ln" id="vtype" />
            <input className="ln" id="license" />
            <input className="ln" id="fleet" />
          </div>
        </div>
        <div className="ws-stack">
          <div className="ws-pair">
            <div className="ws-box lbl w-b">
              <div className="ln">Contract ID</div>
            </div>
            <div className="ws-box val slim">
              <input className="ln" id="contract" />
            </div>
          </div>
          <div className="ws-pair">
            <div className="ws-box lbl w-b">
              <div className="ln">Driver Type</div>
              <div className="ln">Driver</div>
            </div>
            <div className="ws-box val slim">
              <input className="ln" id="dtype" />
              <input className="ln" id="driver" />
            </div>
          </div>
        </div>
      </div>

      <div className="ws-pair">
        <div className="ws-box lbl w-a">
          <div className="ln">Description</div>
        </div>
        <div className="ws-box val slim">
          <input className="ln" id="desc" />
        </div>
      </div>

      <div className="ws-row2">
        <div className="ws-pair">
          <div className="ws-box lbl w-a">
            <div className="ln">First Pick-up</div>
            <div className="ln">Destination</div>
          </div>
          <div className="ws-box val slim">
            <input className="ln bold" id="first_pu" />
            <input className="ln bold" id="dest" />
          </div>
        </div>
        <div className="ws-right2">
          <div className="ws-pair">
            <div className="ws-box lbl">
              <div className="ln">Single Journey</div>
              <div className="ln">Vehicle To Stay</div>
            </div>
            <div className="ws-box val slim">
              <input className="ln" id="single" />
              <input className="ln" id="stay" />
            </div>
          </div>
          <div className="ws-pair">
            <div className="ws-box lbl">
              <div className="ln">Total Distance</div>
              <div className="ln">Empty Distance</div>
            </div>
            <div className="ws-box val slim">
              <input className="ln" id="dist_total" />
              <input className="ln" id="dist_empty" />
            </div>
          </div>
        </div>
      </div>

      <div className="ws-bar cols-it">
        <div>Date</div>
        <div>Time</div>
        <div>Type</div>
        <div>Location</div>
        <RowButtons table="it" />
      </div>
      <div className="ws-itin" data-rows="it" data-min="8">
        {ITIN_ROWS.map((i) => (
          <div key={i} className="row">
            <input id={`it${i}_date`} />
            <input id={`it${i}_time`} />
            <input id={`it${i}_type`} />
            <input id={`it${i}_loc`} />
          </div>
        ))}
      </div>

      <div className="ws-bar cols-2">
        <div>Route</div>
        <div>Further Requirements</div>
      </div>
      <div className="ws-route">
        <textarea id="route" />
        <textarea id="reqs" />
      </div>

      <div className="ws-notice">
        <input
          id="notice"
          placeholder="Notice for the driver (prints in bold)"
        />
      </div>

      <div className="ws-printed">
        <input id="printed" placeholder="Printed: date / time" />
      </div>
      <div className="ws-log">
        <div className="col">
          <div className="ws-box lbls h1">Location</div>
          <div
            className="ws-box lbls"
            style={{ flex: 1, justifyContent: "space-around" }}
          >
            <div>Actual Time</div>
            <div>Odometer Reading</div>
          </div>
        </div>
        <div className="col">
          <div className="ws-box cells h1">
            <div>Start</div>
            <div>First Pick-up</div>
            <div>Last Set-down</div>
            <div>Finish</div>
          </div>
          <div className="ws-box cells two" style={{ flex: 1 }}>
            {LOG_CELLS.map((k) => (
              <div key={k}>
                <input id={k} />
              </div>
            ))}
          </div>
        </div>
        <div className="ws-box lbls">
          <div className="ln">Adults</div>
          <div className="ln">Children</div>
          <div className="ln">Total Pax</div>
        </div>
        <div className="ws-box pax">
          <div>
            <input id="adults" />
          </div>
          <div>
            <input id="children" />
          </div>
          <div>
            <input id="total_pax" />
          </div>
        </div>
      </div>
    </SheetShell>
  );
}

export function RowButtons({ table }: { table: string }) {
  return (
    <div className="ws-rowbtns" data-for={table}>
      <button type="button" data-act="add">
        + Row
      </button>
      <button type="button" data-act="remove">
        - Row
      </button>
    </div>
  );
}

function HowTo() {
  return (
    <details className="howto-d">
      <summary>📖 How to use — Work Sheet</summary>
      <ol>
        <li>
          Click a yellow box on the sheet and type. Leave a box empty if you do
          not need it.
        </li>
        <li>
          For a second line under a Location (for example the street address),
          use the next row and leave Date, Time and Type empty.
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
          To add a line to the itinerary, click + Row at the right end of the
          Date / Time / Type / Location bar. Click - Row to remove the last row
          when it is empty.
        </li>
        <li>
          If the rows no longer fit on one page, a note at the top says how many
          pages the PDF will have.
        </li>
        <li>
          Click Save as PDF. In the print window choose Save as PDF, paper A4,
          and tick Background graphics. Then click Save.
        </li>
        <li>
          What you type stays in this browser on this computer. To start a new
          sheet, click Clear all twice. It empties everything except the CHD
          Inc. name, address and contact lines at the top.
        </li>
        <li>
          To keep a sheet and change it later, click Save file. Next time click
          Open file and pick that file. A file saved on the old admin page opens
          here too.
        </li>
        <li>
          Nothing is saved in the system, and other computers do not see it.
        </li>
      </ol>
    </details>
  );
}
