const {spawn}=require("child_process");const [mock,test,...rest]=process.argv.slice(2);
const m=spawn(process.execPath,[mock],{stdio:"ignore"});
setTimeout(()=>{const t=spawn(process.execPath,[test,...rest],{stdio:"inherit"});t.on("exit",c=>{m.kill();process.exit(c??1)})},800);
