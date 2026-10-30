// 스마트스코어 캡처의 숫자 모양 견본 (scanLayout.js의 cellGlyphs와 같은 12×16 격자, 칸별 진하기를 0~z(35단계) 한 글자로 적음)
// - 견본 캡처: 정답을 아는 스마트스코어 앱 화면 캡처 두 장에서 숫자별로 평균 낸 모양 (0~6, 8)
// - 시스템 글꼴: 앱 화면 글꼴과 가장 닮은 macOS 시스템 글꼴(굵기 600)로 그린 0~9. 견본에 없는 7·9를 채운다
// - 출력용 카드, 사진 배경 카드: 같은 라운드의 두 카드에서 숫자별로 평균 낸 모양 (0~9, 글꼴이 앱 화면과 조금 다르다)
// 모양을 바꾸거나 더할 때는 시험용 캡처로 정확도를 다시 확인한다
import { GRID_H, GRID_W } from "./scanLayout.js";

const RAW = [
  ["0", 0.750, "049lwyxth6102ipvyxxxukd06ovysqquzrj2euyx935gzyq7nwvl0013txtdqxue0001owvhsxtb0000lvvkuys80000hvwpvys70000guxqtxta0000kvwlrxtc0000mwvipwvi0001rxuefuyv723dzyr75mtysppuzog21fnvyxwyuha0038lwyytg510"], // 견본 캡처 일반 칸 12개 평균
  ["1", 0.417, "00006lszu700003brvxzu700005jyxxzu700008uysszu700006p99gzu700002727gzu700000107gzu700000007gzu700000007gzu700000007gzu700000007gzu700000007gzu700000007gzu700000007gzu700000007gzu700000007gzu700"], // 견본 캡처 일반 칸 28개 평균
  ["1", 0.417, "00003kszz9000029rvxzz900004hzyyzz900008vzuuzz900007te6czz900002834czz900000103czz900000003czz900000003czz900000003czz900000003czz900000003czz900000003czz900000003czz900000003czz900000003czz900"], // 견본 캡처 합계 칸 2개 평균
  ["2", 0.690, "01cpwzzvoa102dsxxuvxwsb24jyxsmntyyg37rzqb01ftzn68rte2006kyt927731009ozq70000002erym50000007qyyc2000019uzvh100003bqyti5000029jxwma100006oyzo7000019uzxl3000007pyzyupooom89vzzzxxxxxubawzzzzzzzzxc"], // 견본 캡처 일반 칸 14개 평균
  ["2", 0.750, "05cuzzzym6104mtyzxxzwme08syyqopuztl0huyw204ezzq1lusg0001zzs757740016zzr30000004dzxo10000019vzqh000002muzwa200001mvxxb3000028uywq3100018tzyq500002mvzyd400000huyzytqppplanwzzzyyyyytdpwzzzzzzzzue"], // 견본 캡처 합계 칸 2개 평균
  ["3", 0.704, "01bpwzzwoa102fswxuuxwrc15myxsmmsyxi39szq901ctzp66gg81005nyt82442002etzp5000158blvvi30004kwzzvj400004jwzzysc2000158ahtxr912210019oyxd59930001fxygexym6007oyxd9rzwrmnswzr85kuxyvvyxtj403frxzzxqe20"], // 견본 캡처 일반 칸 36개 평균
  ["3", 0.667, "00luyzzwp9005jvyywyyxt617szvsnqwyza39zzja02owzj55kj5000gozp61551005ovzi4000359dsxwc3000dmyzzwl00000dlyzzyv62000358bpvyp61321003iqzw83b920007gzz99zzf600hqzx88xzuropuxzm66pwyywyyxue312pwzzzxse00"], // 견본 캡처 합계 칸 2개 평균
  ["4", 0.750, "00000dlzzlc000005nuzzlc00000bryzzlc00001owzzzlc0003czvsozlc0028pzlilzlc006dvwfckzlc00enzo76kzlc08rxw625kzlc0lvvl316kzmd1rxwmaadozpi8wyzzzzzzzzyusuuuuuvxzywq778888cozoh60000005lzlc00000005lzlc0"], // 견본 캡처 일반 칸 36개 평균
  ["4", 0.742, "000006fyzvm100001gqzzvm100005mvzzvm10000euzzzvm10015uywoyvm1004iyuoeyvm1028pypibyvm106gyxf7ayvm12kuzj52ayvm1csxv933byvn2ivyvdabhywqaoxzzzzzzzzzwmvxxxxxyzzyu588888ahywp90000002byvm10000002byvm1"], // 견본 캡처 합계 칸 20개 평균
  ["5", 0.667, "3bzzzzzzzzk53dzzzyyyyyj54fzwtpppppe34izmd00000005mzja00000006ozlhhkgc5006qzpnptpld217rzzzzzzyw927tznf36lszr727964119hyu812210005dxw829931004cww87tzjb00dlzr75lzvslmsvyh43euxxuvxwsa301erwzzuoc00"], // 견본 캡처 일반 칸 8개 평균
  ["6", 0.750, "026iuyzxn8200fnvyzzzwph13muztrrtzwo3atzzb339zzt9kvvk0000dgf9pxtcaghhd742sxuejoqqj950xzxrzzzzzqh1zzzzb55dzztaxywl3113pxuhuyug0000lwvjowud0000jvvkhuxt2115wytb6ouxplmryvn41gowxuuzwog1028nxzzxm720"], // 견본 캡처 일반 칸 4개 평균
  ["6", 0.750, "027lwyzyq9200hpwyzzzxrj13owztrrtzyq3ctzzd33bzztbnwwn0000fjhasxuecikjf853vyuglrsska50yzyuzzzzzsk0zzzzc56fzztcyzwn3114sxvjwyvi0000owwmsxug0000mwwnkvyw3115yzud7qxyqnoszxp52iqxywwzxqi2039ryzzyp820"], // 견본 캡처 합계 칸 4개 평균
  ["8", 0.750, "06euzzzyn7105nuyxuvzwog0atzypmntzvn1jvyw203bzzr3owwn0001zzs7guyv524ezyq2aqwyeadmytl10fnzzzzzwe604pwzzyyzzog0nvxua9agzwqauywo1027xyugzzta0000rxwoxzwm0014xzvjnwywolmrzzs9eqvywuvyxtl40bjwzzzysb40"], // 견본 캡처 합계 칸 2개 평균
  ["0", 0.750, "0026hlkd310008fsuwvtra302fozuttwzh807szzgacozum1mwwn0013xztaqxuf0001qxueuytb0000nwuhzzs80000kvwlzzs70000ivwnwyta0000lwvjtxtc0000owugowuh0000tytcguzx213bzzs55nvzpkltzog11hpxxstzvh9004apzzzxk500"], // 시스템 글꼴 600 일반
  ["1", 0.417, "0000059ff4000001dosuu7000028mvzzz900007szyyzz900009zmbezz900004h55dzz900002804czz900000004czz900000004czz900000004czz900000004czz900000004czz900000004czz900000004czz900000004czz900000004czz900"], // 시스템 글꼴 600 일반
  ["2", 0.667, "002bflmhc30013nsuwwuso4129vwvsswxwa36mzsk67nuzm68wzd4008hzw82893100ckzs70000002hpzn60000007szza3000016xzvk0000039pzsl5000019hxwld000004pxzn6000014vywm1000006myzxtnnnnn67tzzywwwwww88wzzzzzzzzz9"], // 시스템 글꼴 600 일반
  ["3", 0.750, "003bilkf62002fltvvvuse705mtytstvzmd0guyt979jzyp1jnl80002zzr45652003bzwo1000278bjxqi00028svxzqa400029wyzzsg9000128acixun33320014axzs7bc910000sxuguyuf0014xztcjvyukikqzyr5bpvytrsyxsk20aiwzzzzq930"], // 시스템 글꼴 600 일반
  ["4", 0.750, "000009cff85000006ntuug900000euzyzja00002uyyvzja0005jznknzja004bvxdanzja009hzr87nzja00ktzb36nzja0ctxq006nzja0rxtb006nzkb1xyud99dqzohazzzzzzzzzzzxttttttuxzxvr777777cqzmf70000006ozja00000006ozja0"], // 시스템 글꼴 600 일반
  ["5", 0.750, "2cfffffffda05ouuuuuuurj07syxtttttqj09sxqcccccb80ctvj00000000euugaefc5100fuvkinole630hvywzzzzzja0kvyu969jzzr49eea2225uyta69830000rxtd89820000nwufmwvk0015xzs7ctyvkijqzum27nuytqsywog008gwzzzzo710"], // 시스템 글꼴 600 일반
  ["6", 0.750, "0015flmj920007esuwwvtib02enzutstzri27szzh98dzztamwvl00008cc8rxtb9dfea532uytchmong950zzwpzzzzzqh1zzzze88fzztdzzwn4224owvjxzvi0000jvwmtxuf0000guwohvxs2012txuf6ryxoiioxxq72ksxwrrwxrk304arzzzzsb40"], // 시스템 글꼴 600 일반
  ["7", 0.667, "4fffffffffa37uuuuuuuuul57ttttttwyzn63ccccccouzl50000005szz51000000ivxp10000001pxvi00000016zzs50000006nzpg0000004cwzg70000008hzwb3000000irzm50000007szz51000000lvxp10000002sxvi00000028zzs5000000"], // 시스템 글꼴 600 일반
  ["8", 0.750, "003ahlkg82002eltvvvusib05mtytrstzqi2euyw956dzzs8lvvk0000rxuectxs4126xzs67ouwc9afyum30aixzyyzue703kszzzzzzph1kuwtb9aewwresxwn3115sxwlzzta0000guytwyvi0001pwwplwyvjgglwyufdqvysopuyuo80aiwzzzzue70"], // 시스템 글꼴 600 일반
  ["9", 0.750, "014ckmlg41002gntvwwuqc507nuytstwyjb0mwyva7amzxo2wys90000uyueyzs70000sxvixzta0012txvlsxvl0028zzwpdtzzurszwyxp3fmuyxvolwvl07dmrqogjvvi00002100owudrxvh0029zzs6fuyvjjlszog19ovzsstyvg9009ixzzywj500"], // 시스템 글꼴 600 일반
  ["0", 0.750, "0027jonf41000ahsvwwura302hpzvtuxzi909szziberzxo2pwxr0013zztbtyvh0001tyugwyud0000qxvjzzta0000nwwozzs80000lwxryztb0000owwmwyue0000rxvjsxvj0000wyueivzz213czzs65pxzqmntzqi11jrxyvvzwjb004bszzzzn600"], // 시스템 글꼴 600 합계 칸 색
  ["1", 0.417, "000006ahh4000001fptvv8000028owzzz900008vzzzzz900009zpcfzz900005i66dzz900002904dzz900000004dzz900000004dzz900000004dzz900000004dzz900000004dzz900000004dzz900000004dzz900000004dzz900000004dzz900"], // 시스템 글꼴 600 합계 칸 색
  ["2", 0.667, "003ciopje40014ptvwxvtq513axxwssxyyb36pzun78pwzq68yze500aizy82893100dmzv80000002iqzq60000008szzc3000027zzwn000003arzun600001aiyxnf000005ryzq7100015yzxp1000006pzzywppppp68wzzzyyyyyy88yzzzzzzzzz9"], // 시스템 글꼴 600 합계 칸 색
  ["3", 0.750, "004dloni72002gnuwwwvsf806ovytstwzof0ivywa8amzzq1mroa0002zzr55762003dzyp1001288clysk00029vxyztc40003ayzzzvib000138adkyvn43330014byzs9deb10000vyvjxzvh0014zzuelwyvnlmrzzs6dqvzvuvzxtl20ckyzzzztb30"], // 시스템 글꼴 600 합계 칸 색
  ["4", 0.750, "00000afhha5000007ouvvia00000guzzzlc00002xzzyzlc0006mzqnqzlc004cwyecqzlc00ajzt88qzlc00nvzd36qzlc0euxt006qzlc0tytd007qzmd1yzue99eszpjazzzzzzzzzzzzwwwwwwwzzyxu888888dtzoh70000007szlc00000007rzlc0"], // 시스템 글꼴 600 합계 칸 색
  ["5", 0.750, "2dhhhhhhhfb06ovvvvvvvtl08szyuuuuusl0atyueeeeec90euwl00000000guvjbghe6200ivwmkpqnf730kvzyzzzzzlc0nwyxa7amzzr5bffb3236wytc7a940000uyuf9a930000rxvhpxwn0016zzs8euywnklrzwo28ovzvtuzxqh009hyzzzzr810"], // 시스템 글꼴 600 합계 칸 색
  ["6", 0.750, "0016hoplb30008fsvwxwtkd02gozvttuzsk38szzjbafzztbpwwo0000aed9uyudaghhc642wyuejoqpia50zzxszzzzzsk1zzzzh99hzzufzzxp4224qxwmyzvl0000mwxpwyvh0000jvxskvyv2012wyvi7szyqllqyys82ltyyttyytl404cuzzzzvc40"], // 시스템 글꼴 600 합계 칸 색
  ["7", 0.750, "6ehhhhhhhhgcbqvvvvvvvvtobpuuuuuuyzxq4beeeeeevywo00000016zzs60000005kztl20000018szof0000005ezzd5000000ktzp60000006qxzb3000000dtyx51000000sxxp00000029zzs60000006oztl10000029uzof0000007gzzd400000"], // 시스템 글꼴 600 합계 칸 색
  ["8", 0.750, "003ckooja2002gntvwwvtkd06ovztssuzsk2guzyb66fzzt9owwn0000vyugeuyv4127yzs78pvydaagzum30bkzzzzzxg804nvzzzzzzsj1nvxvcaaeyxsguyxp3116uywozztc0000jvywyzvl0001sxxsowyvliinxzuhfqvzurrwyuoa0clyzzzzxg80"], // 시스템 글꼴 600 합계 칸 색
  ["9", 0.750, "015enpoj41002ipuwxwvrd608pwztstwzlc0pwzyb9cpzyq2yzta0000xzugzzs80000vywlyztb0012vywovywo0029zzxsfuzzxvvzyzxs4gnxzywrowwo09forqoimwvk00002100sxufuyvk003azzs6ivyvllntzph2apvzuuvzwia00bjzzzzyl500"], // 시스템 글꼴 600 합계 칸 색
  ["0", 0.708, "003esxwpb10003pzzzzzyk100gzyk35pzya01wzr2005vzp0azzg0000ozy2hzz80000gzz8lzz40000dzzdnzz20000bzzenzz20000bzzflzz40000czzchzz80000hzz9azzg0000ozy21wzr2005uzp00gzyk35pzya003pzzzzzyk10003esxxpb100"], // 출력용 카드 평균
  ["1", 0.372, "000008vyw0000001bvzzw000000hywxzw000000kp9ozw000000201nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000000001nzw000"], // 출력용 카드 평균
  ["2", 0.664, "003dpwyvl80009tyzzzzzwe00ixpb32fxzs30ge20000kzw600000000fzw700000001mzu500000007xzn10000003qzv50000002kzwa0000002lyye1000001hyxg0000001jyyg1000001fyxh0000000gxzi10000003uzzzzzzzzy83uzzzzzzzzy8"], // 출력용 카드 평균
  ["3", 0.658, "03amvywpc2002oyzyzyzyn204urd317pzyf03d400006yzo000000003xzn00000000cyyc0000069huxk100000uyzvd2000000otvywh200000014eyyl000000000qzu200000000lzw35f300002szt26yqd416myyi04tyyyyyzym1004dpwywoa200"], // 출력용 카드 평균
  ["4", 0.778, "0000009yys30000003rzzt4000000jyxzt400000axupzt400004qxcnzt40000kyn2nzt40009xv50nzt4004rxe00nzt400iyo200nzt40bwv4000nzt40pyk5555pzu85szzzzzzzzzzxlqqqqqqxzxro0000000qzt400000000qzt400000000qzs40"], // 출력용 카드 평균
  ["5", 0.663, "05xyyyyyyxd006yyuttttsc008yu700000000ayt600000000cys500000000eyr300000000gywrsrmd4000gsrqqtxxo300342114evym100000002jzw600000000byy800000000dyy723000002nyt36si8216mxyd05qxvttuyxl2007jswyvpd200"], // 출력용 카드 평균
  ["6", 0.681, "00029ovxvp90001ivyvuuwl101gwxj604eh004uxg10000100eyq200000000oyhaosrj6005rznwvuwys508tzxp85gvyl19uzs4000izx79uzk10009yyc7tyf00007xyd3qyh00009yyb0lyr4000jyv607xxn42fwyi001jwyvuxxq40002dqwxsh500"], // 출력용 카드 평균
  ["7", 0.676, "dxyyyyyyyywbdyyyyyyyzzxb00000001kzu700000007vzn10000000jzyc00000002vzp20000000cyyd00000002rzw300000008yyi00000000pzt500000005xzj10000001hyy600000005tzp10000000gyyb00000002vzs20000000bxye000000"], // 출력용 카드 평균
  ["8", 0.681, "007ktxxsi70008uxlabmxt602oyo2002pym18uze0000hzv49uzg0000jzw52pzs9118tzn109vyrijtyu60009tyzyzr80007uxneenwt606rym3014nzr3fxy70000byybhyx500007yzegyyb0000ezzc8tztc12duzu40fwyxvuxywc001amuyxula00"], // 출력용 카드 평균
  ["9", 0.681, "004iuyysf30004qyyuuyyn200izwg12jxya05szn1001oyo1bvzd0000fzw5cwza0000czy9avzc0000izzb5szj1003qzzb0fyvh9bmxyy903lvvuutjyw5000ailg5ezr200000001ozg00100000dxx500gh514hwyj000jxwuvxxk20007ovywqc2000"], // 출력용 카드 평균
  ["0", 0.672, "0029lssma20001fvxrqwvg2009vyh22hxua01kyt4004syl12ryl1000lys34uyg0000fyv55wye0000dyw65wxd0000bxw75xxd0000bxw75wye0000dyw64vyg0000fyv52syl1000lys41lys4004sym20avxg22gxvb001gwxqpwwh20002bouuob200"], // 사진 배경 카드 평균
  ["1", 0.405, "00013aoof0000028huwuj000026mxstvj000056ficpuj000022279puj000000279puj000000279pvj000000279pvj000000279pvj000000279pvj000000279pvj000000279pvj000000279pvj000001279pvk100024589pwn530024689nsl540"], // 사진 배경 카드 평균
  ["2", 0.624, "014bjookc30008qwvuvwwk300fuh835iwwe018b20028syj001000016ryl00000001bvyj00000002kywd0000001bwyn40000007syv81000006ryud1000004lyxg3000003nyxh2000004iyxk4100001gxyn41110002qzyusssssm22mtttttttsn2"], // 사진 배경 카드 평균
  ["3", 0.646, "029ipsrmd4001euwutuwvl401kpd637kxwe119510128uxl101000016tyl10000001bwwd0000026drxl300002lwxwi4000002fmpvvl500000014cuxk100000014myt301000003jyu33g510015oyr24uqe526jwwg12mvwvvvxui3003aiopoja300"], // 사진 배경 카드 평균
  ["4", 0.733, "000001fttf10000007tyyh1000003owxyh100001fwnuyh100018ssbtyh10004nwe5tyh1001dwp54tyh1007rua14tyh002lwi304tyh00dwq6115tyh10myndccfvync7nywvvvwyzxvj9dddddgwyod81111116uyh110000005uyh000000005svg00"], // 사진 배경 카드 평균
  ["5", 0.670, "09qtuuuuutf00dvwrppppob00hytc99985200jyr722221100lyp500111001mypa88620002nywtuuqj8102lrpopswwq80177546akvwm300000027nxt600000004hwu800000003jwu713100017qxp57od5227mxvf17vxtqptxvj402bmswwtnd410"], // 사진 배경 카드 평균
  ["6", 0.697, "1115eossrn91115kttnmnpg312ixuhacfc7119uwi31244102iyp800000004qxh8bda50007uwnptusnb109xywqiirxtb1bxzqb42eswm5bxyi4007pxq8bxwe2005nys98vxf4006oxr95qyk7009rxo71hytf33jwvh406pxtlmvwn71017muyxtm810"], // 사진 배경 카드 평균
  ["7", 0.689, "3hpqqqqqqqpb6innnnnnrtpaennnnnnoxwl33666667nyuc00000005uzo30000000gywa00000003rzq40000001dxxf10000003ozt700000009vym20000001hyxg10000005ryra0000001dxxm70000003qytg6000000bxxne5000003kysie50000"], // 사진 배경 카드 평균
  ["8", 0.657, "002akoolc30003htwwwvtj400evxkbclwvg11myq7116qxn22pyn4002oyq21myt9205sym10cvyod9lyub001cuzyyztc1003iwtjmuwi301kxs612atxk13tyi1002lys44xxe0000gxv54vyh1001jyv52rys7118syr40ctyvnnvytc1018ktwwtk820"], // 사진 배경 카드 평균
  ["9", 0.647, "003dmppk921003hsvuuwrd100etxndcmxs901nxs9216rwk11rym3001kxq11syj1000gxu21ryl1000kyv21mys5117tzw20auyoceqyyv201csyyxtnxu10017ili8ixq100000002qxi00110001bxt8007c512asxi200evvrsxxj40004iswvpe3000"], // 사진 배경 카드 평균
];

export const DIGIT_TEMPLATES = RAW.map(([digit, aspect, cells]) => {
  if (cells.length !== GRID_W * GRID_H) throw new Error(`숫자 견본 크기가 맞지 않습니다: ${digit}`);
  return { digit, aspect, grid: Float32Array.from(cells, (c) => parseInt(c, 36) / 35) };
});
