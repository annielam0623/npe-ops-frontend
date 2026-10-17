/**
 * 深色页面版的 How to use（同 dispatch-view.tsx 的本地写法）。共用的 components/ui/how-to-use.tsx
 * 是浅色页面那一套配色，这页照深色主题自己写一份，收起状态和文案风格一致。
 */
export function HowToUse() {
  return (
    <details className="max-w-3xl rounded-[18px] border border-sky-400/20 bg-sky-400/[.06] px-5 py-4 text-sm leading-relaxed text-white">
      <summary className="cursor-pointer font-semibold text-sky-300">
        📖 How to use — 7 Days Forecast
      </summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>
          One block per bus tour route, showing the next 60 days starting today
          (Los Angeles time). Scroll the table sideways to see later days; the
          left column and the day headers stay in place.
        </li>
        <li>
          Each block&rsquo;s bold first row (the route name) is the total pax
          for that route (outbound and inbound count once, since it&rsquo;s the
          same vehicle doing both trips). The rows underneath break that total
          down by section and outbound / inbound shuttle, like Canyon Coach
          Lines&rsquo; sheet (a route with only one, like Valley of Fire, shows
          just the bold row). The sections and their order come from Settings →
          Products → Bus Manifest setup.
        </li>
        <li>
          A <b>-</b> means the tour doesn&rsquo;t run that day; a <b>0</b> means
          it runs but nothing is booked yet. Point at a - to see why: a weekday
          or closed date set in Settings → Products → Bus Manifest setup, or
          Canyon Coach Lines marked it Closed in Discord.
        </li>
        <li>
          <b>Max allotments</b>: the left column shows each row&rsquo;s cap and
          time (U = Upper, L = Lower, X = Canyon X). Each day shows the seats
          left in blue, or in red when it is oversold. A cap in yellow after the
          number means that day has a different cap, set for those dates in Bus
          Manifest setup.
        </li>
        <li>
          <b>Crew notes</b>, <b>CCL major events</b>,{" "}
          <b>Pax (tour 1, tour 2)</b> and <b>Driver / Vehicle type</b> are typed
          in by staff: click a cell from today on, type, and Save. Clear the
          text and Save to remove it. Point at a cell to see who wrote it and
          when.{" "}
          <b>Sunset depart times</b> and <b>Private tours</b> fill in by
          themselves from the bookings. Notes stays
          empty for now.
        </li>
        <li>
          A vehicle number in red in the Driver / Guide row has no GPS (no
          Samsara link in Settings → Vehicles).
        </li>
        <li>
          When vehicle sizing is turned on, a cell in that bold row is colored
          by which vehicle tier fits that day&rsquo;s pax count — see the legend
          above the table. A total of 0 is never colored.
        </li>
        <li>
          The <b>Driver / Guide</b> row at the bottom of each block shows who is
          on that run. A <b>CCL</b> tag means Canyon Coach Lines already posted
          their schedule in Discord for that day — read only. A <b>Plan</b> tag
          means no one has posted yet; click that day&rsquo;s cell to add or
          remove a guide. Past days and days CCL already posted can&rsquo;t be
          edited here.
        </li>
        <li>
          <b>Hide rows that are all 0</b> hides routes and breakdown rows with
          no bookings at all in the next 60 days, to make the table shorter.
        </li>
        <li>
          Lines CCL posted that don&rsquo;t match any route (Private Tour, lines
          we couldn&rsquo;t read) are listed in the collapsed panel below the
          table instead.
        </li>
      </ol>
    </details>
  );
}
