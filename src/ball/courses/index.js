import basic from "./basic.js";
import fork from "./fork.js";
import short from "./short.js";

// 화면에서 고를 수 있는 코스. 새 코스는 이 폴더에 파일을 만들고 여기에 더한 뒤
// node scripts/ball-sim.mjs로 끼임·한 판 길이·자리 쏠림을 확인한다
export const COURSES = [basic, fork, short];

export const courseOf = (key) => COURSES.find((course) => course.key === key) ?? COURSES[0];
