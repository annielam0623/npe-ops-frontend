// run-all 入口（e2 2026-11-26）：g382-leave-test.js 用 sch-mock（Staff Schedule 的 mock）当后端，端口照 MOCK_PORT。
// g382-leave-test 点的是只在 next dev 下有的检查页 /zz-g382-leave-harness（页面里拦 fetch），这里只给页框（/api/me 等）一个后端。
require("./sch-mock.js");
