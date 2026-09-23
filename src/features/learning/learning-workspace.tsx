'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { courseStageLabels, courseTrackLabels, courseTracks, defaultCourseTrack, stagesOf, type ActionResponse, type AssignmentView, type AttemptView, type CourseTrack, type LessonDocument, type ContentBlock, type EnrollmentView, type LearningAction, type LearningState, type PublicLesson, type PublicProblem, type PublicProblemSet, type PublicConcept, type PublicCourse } from '@/shared/api';
import { ApiError, learningApi, supportsWebAuthentication, type Session } from './api-client';
import { placeSearch, readPlace, sameWork, type Page, type Place } from './app-url';
import { assertLearningResponseAccount, clearAuthReturn, GOOGLE_LOGIN_PATH, isNativeBrowser, LearningResponseError, parseAuthError, readAuthReturn, saveAuthReturn, type AuthReturn } from './auth-client';
import { DiagnosticPanel } from './diagnostic-panel';
import { FirstStep } from './first-step';
import { ReadinessList } from './readiness-list';
import { StandingByCourse, WayThere } from './standing';
import { GoogleLoginButton } from './google-login-button';
import { ServiceFooter } from './service-footer';
import { ContentBlocks, unsupportedRequiredBlocks, type GlossaryContext } from './content-blocks';
import { ConceptExplorer } from './concept-explorer';
import { canExploreDefinitions } from '@/shared/definition-exploration';
import { nearbyAssignments, nearbyLessons } from '@/shared/nearby';
import { ProblemCard, type ProblemActions } from './problem-card';
import { AnswerReport, type ReportItem } from './answer-report';
import { Icon, type IconName } from './icons';

type Dispatch = (action: LearningAction) => Promise<ActionResponse>;
const roleLabels = { explanation: '개념 이해', worked_example: '함께 풀기', practice: '직접 연습', check: '확인 퀴즈', summary: '마무리' };
/**
 * A course from a server that has not heard of tracks is on the line the catalogue is ordered
 * along, which is where every course was before there was a second line. A static mobile build
 * talks to whichever server it was pointed at, so the screen reads the field rather than trusting it.
 */
const onATrack = (course: PublicCourse): PublicCourse =>
  courseTracks.includes(course.track) ? course : { ...course, track: defaultCourseTrack };
/**
 * What each line of study says about itself where the catalogue splits. The school line is the one
 * the catalogue is ordered along and the one a learner is carried down; the other is somewhere a
 * learner arrives on purpose, so it says what it is for rather than where it comes in the order.
 */
const trackIntros: Record<CourseTrack, { note: string }> = {
  basics: { note: '학년과 상관없이 여기서 시작해요. 위의 모든 과정이 이 셋을 바탕으로 삼아요.' },
  middle: { note: '학교에서 배우는 차례 그대로예요. 앞 학년이 뒤 학년의 바탕이 돼요.' },
  high: { note: '중학교 과정 위에 서요. 중학교에서 다룬 것을 한 번 더 넓히고 깊게 봐요.' },
  ncs: { note: '취업 시험의 수리영역이에요. 학교 과정과 따로 있으니 필요한 것만 골라 풀어도 괜찮아요.' },
};
/** The courses of one line, in the order the catalogue gives them, cut into the years they belong to. */
const byStage = (courses: PublicCourse[], track: CourseTrack) => {
  const held = courses.filter((course) => course.track === track);
  const years = stagesOf(track).map((stage) => ({ stage, courses: held.filter((course) => course.stage === stage) }))
    .filter((year) => year.courses.length);
  // A course on a line that keeps no years, or one that names none, is listed under the line itself.
  const loose = held.filter((course) => !years.some((year) => year.courses.includes(course)));
  return loose.length ? [{ stage: null, courses: loose }, ...years] : years;
};
const navItems: { page: Page; label: string; icon: IconName }[] = [
  { page: 'home', label: '내 학습', icon: 'home' }, { page: 'lessons', label: '수업', icon: 'book' },
  { page: 'practice', label: '연습장', icon: 'pencil' }, { page: 'history', label: '학습 기록', icon: 'chart' },
];
const formatDate = (value: string) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));
const assignmentKindLabel: Record<AssignmentView['policy']['kind'], string> = { review: '복습', homework: '숙제', exam: '시험', practice: '직접 고른 문제집' };
const formatMoment = (value: string) => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
/**
 * Opening, deadline, and recommendation are separate promises.
 *
 * A set the learner opened themselves has none of them — it was recommended by nobody and is due
 * never — so it says when it was started instead of promising anything about when to do it.
 */
const assignmentTiming = (item: Pick<AssignmentView, 'recommendedAt' | 'opensAt' | 'dueAt' | 'policy'>) =>
  item.policy.kind === 'practice' ? `${formatDate(item.recommendedAt)} 시작` : [
    item.opensAt ? `${formatMoment(item.opensAt)} 시작` : null,
    item.dueAt ? `${formatMoment(item.dueAt)} 마감` : null,
    !item.dueAt ? `${formatDate(item.recommendedAt)} 권장 · 마감 없음` : null,
  ].filter(Boolean).join(' · ');
const messageOf = (error: unknown) => error instanceof Error ? error.message : '문제가 생겼어요. 다시 시도해 주세요.';
/**
 * Takes the learner to one question of a set: the card comes up to the top of the screen and its
 * box takes the cursor. It is asked for by number and done after the redraw, because the box a
 * saved answer sends the learner on to is still disabled while that save is being recorded.
 */
/**
 * Where a course's sets stand on the shelf, and where one lesson's sets stand inside that course.
 * Both are drawn as ids so that a door elsewhere in the app can name the exact place it opens.
 */
const shelfGroupId = (courseKey: string, lessonKey: string | null) =>
  lessonKey ? `shelf-${courseKey}-${lessonKey}` : `shelf-${courseKey}`;

function showProblem(index: number) {
  const card = window.document.getElementById(`problem-${index + 1}`);
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  card.querySelector<HTMLInputElement>('input:not([disabled])')?.focus({ preventScroll: true });
}

/**
 * The mark: a cat with its eyes closed, a paw resting where its chin would be, and a set square
 * leaning across the right of its face. It is kept here as paths rather than an <img> so it
 * inherits nothing and costs no second request, and because the same drawing has to exist in
 * src/app/icon.svg for the browser tab; tests/app-icons.test.ts holds them equal.
 *
 * The paths are not ours. They come straight out of ~/Documents/그냥스타일/download.svg — the
 * commissioned mark, as vector — with the wordmark below it dropped and the rest set on the plate
 * by the single transform below. Earlier passes read landmarks off a raster of the same drawing and
 * joined them up, and got the ears and the paw wrong twice. A few points are not a shape; ask for
 * the vector instead.
 */
function Brand() {
  return <span className="brand"><span className="brand-mark" aria-hidden="true">
    <svg viewBox="0 0 600 600" fill="none">
      <path d="M468 0H132C59.0984 0 0 59.0984 0 132V468C0 540.902 59.0984 600 132 600H468C540.902 600 600 540.902 600 468V132C600 59.0984 540.902 0 468 0Z" fill="#FAF6EE" />
      <g transform="translate(-125.6 -72.9) scale(1.9)" strokeLinecap="round" strokeLinejoin="round">
        {/* 얼굴. 한 획으로 왼뺨을 올라 두 귀를 넘고, 자에 닿기 전 허공에서 끝난다 */}
        <g stroke="#141414" strokeWidth="13">
          <path d="M143 251 C127 240 120 223 121 203 C122 180 132 162 152 150 C155 130 164 114 173 104 C192 112 208 125 221 142 C234 125 252 113 271 104 C282 117 289 132 292 150 C298 153 304 158 309 164" />
        </g>
        {/* 감은 눈 */}
        <g stroke="#141414" strokeWidth="11">
          <path d="M182 201 C188 209 201 209 207 200" />
          <path d="M237 200 C243 209 256 209 262 201" />
        </g>
        {/* 수염 */}
        <g stroke="#D2674A" strokeWidth="10">
          <path d="M103 207 C117 201 131 199 146 201" />
          <path d="M110 232 C121 223 132 219 146 219" />
        </g>
        {/* 앞발. 턱이 있을 자리에 놓인다 */}
        <g stroke="#141414" strokeWidth="12">
          <path d="M124 288 H177 C193 291 205 281 200 267 C195 253 178 246 160 250 C142 253 131 267 130 282" />
        </g>
        {/* 삼각자. 가운데가 비어 보여야 해서 한 길 안의 두 고리로 그린다 */}
        <g fill="#D2674A">
          <path fillRule="evenodd" d="M338 150 C342 146 350 149 350 155 V287 C350 292 347 295 342 295 H213 C206 295 203 288 208 283 Z M324 194 L248 273 H324 Z" />
          <path d="M305 234 C307 231 311 233 311 237 V257 C311 259 310 260 308 260 H287 C284 260 283 257 285 255 Z" />
        </g>
      </g>
    </svg>
  </span><span className="brand-word">그냥<span>수학</span></span></span>;
}








/**
 * The drawing a lesson wears, and the one the problem sets of that lesson wear with it.
 *
 * A set borrows its lesson's mark instead of drawing one of its own, because that is what says the
 * set is the work of the lesson just read — three sets under one lesson heading are siblings, not
 * three unrelated things. `small` is the same mark at the size of a list row.
 */
/**
 * The drawings a lesson card wears, and the topic each one belongs to.
 *
 * The mark is read off the lesson's key rather than hashed from it, so a lesson about 분수 is drawn
 * as a bar cut into parts and one about 좌표 as a pair of axes. That is the whole reason the drawing
 * is there: a shelf of cards should be scannable by what the lessons are about, and a mark that
 * means nothing is just a coloured rectangle taking up the top half of a card.
 *
 * There are twenty-eight of them because seven could not tell the catalogue apart — a shelf of
 * 도형 and a shelf of 확률 came out wearing the same balance. Everything is stroked in currentColor
 * on a plate of squared paper, which is the surface this work is actually done on.
 */
/* Each drawing is nudged so its ink sits in the middle of the 120x80 box. They were drawn by hand
 * at whatever coordinates read well while drawing them, which left several — 지수, 정수, 소수 — hanging
 * low enough that the card showed a band of empty paper above them. The numbers are measured, not
 * guessed: every mark is rendered alone and its ink extent read off the pixels, strokes and round
 * caps included. Move a path and the offset beside it stops being right, so re-measure rather than
 * adjusting it by eye. */
const LESSON_MARKS: Record<string, ReactNode> = {
  // 분수·유리수
  fraction: <g transform="translate(0 -1.8)"><rect x="16" y="30" width="88" height="24" rx="2" /><path d="M38 30.5V53.5M60 29.5V54M82 30.5V53.5" /><path d="M18 52 34 32M22 53 36 38M26 53.5 36 45M42 52 57 32M46 53 58 39" strokeWidth="1.4" /></g>,
  // 소수
  decimal: <g transform="translate(0 -7.8)"><rect x="16" y="32" width="88" height="20" rx="2" /><path d="M24.8 32v20M33.6 32v20M42.4 32v20M51.2 32v20M60 32v20M68.8 32v20M77.6 32v20M86.4 32v20M95.2 32v20" strokeWidth="1.2" /><path d="M16 32h35.2v20H16z" fill="currentColor" stroke="none" opacity=".85" /><path d="M16 62h35.2M16 60v4M51.2 60v4" strokeWidth="1.3" /></g>,
  // 비와 비율
  ratio: <g transform="translate(2 -4)"><rect x="16" y="22" width="48" height="18" rx="2" fill="currentColor" stroke="none" opacity=".85" /><rect x="16" y="48" width="84" height="18" rx="2" /><path d="M16 14v-2M64 14v-2M16 13h48" strokeWidth="1.3" /><path d="M16 74v2M100 74v2M16 75h84" strokeWidth="1.3" /></g>,
  // 백분율
  percent: <g transform="translate(0 -1)"><rect x="30" y="20" width="60" height="42" rx="2" /><path d="M45 20v42M60 20v42M75 20v42M30 34h60M30 48h60" strokeWidth="1.3" /><path d="M30 20h30v28H30z" fill="currentColor" stroke="none" opacity=".85" /></g>,
  // 약수·인수분해
  factor: <g transform="translate(5 -2.8)"><path d="M60 18v10M60 28 38 44M60 28 82 44M38 52 28 66M38 52 48 66" /><circle cx="60" cy="16" r="5" fill="currentColor" stroke="none" /><circle cx="38" cy="48" r="4.5" /><circle cx="82" cy="48" r="4.5" fill="currentColor" stroke="none" /><circle cx="28" cy="70" r="4.5" fill="currentColor" stroke="none" /><circle cx="48" cy="70" r="4.5" fill="currentColor" stroke="none" /></g>,
  // 정수·유리수
  negative: <g transform="translate(0 -9.6)"><path d="M12 42h96" /><path d="M36 36v12M60 30v18M84 36v12" /><circle cx="36" cy="42" r="5.5" fill="currentColor" stroke="none" /><path d="M24 62h14" strokeWidth="2.6" /><path d="M82 62h14M89 55v14" strokeWidth="2.6" /></g>,
  // 제곱근·무리수
  root: <g transform="translate(-3 -2)"><path d="M22 44 32 44 44 66 60 18 104 18" /><path d="M60 30h44" strokeWidth="1.4" strokeDasharray="4 4" /></g>,
  // 지수·다항식
  power: <g transform="translate(2 -7.8)"><rect x="30" y="16" width="56" height="56" rx="2" /><path d="M58 16v56M30 44h56" strokeWidth="1.3" /><rect x="30" y="16" width="28" height="28" fill="currentColor" stroke="none" opacity=".85" /><path d="M30 78h56M30 76v4M86 76v4" strokeWidth="1.3" /></g>,
  // 문자와 식
  variable: <g transform="translate(0 -7.8)"><rect x="16" y="30" width="26" height="24" rx="3" /><path d="M52 42h14M59 35v14" strokeWidth="2" /><rect x="74" y="30" width="30" height="24" rx="3" fill="currentColor" stroke="none" opacity=".85" /><path d="M16 66h88" strokeWidth="1.3" strokeDasharray="3 5" /></g>,
  // 방정식
  equation: <g transform="translate(0 1)"><path d="M60 20v38M40 58h40" /><path d="M22 34h76" /><path d="M22 34 12 52h20ZM98 34 88 52h20Z" /></g>,
  // 부등식
  inequality: <g transform="translate(1 -1)"><path d="M60 22v36M40 58h40" /><path d="M20 26 100 42" /><path d="M20 26 8 42h22ZM100 42 90 60h20Z" /></g>,
  // 좌표평면
  axes: <g transform="translate(-2 1)"><path d="M26 12v54h72" /><path d="M40 66v-4M58 66v-4M76 66v-4M26 54h4M26 38h4M26 22h4" strokeWidth="1.3" /><circle cx="58" cy="38" r="5" fill="currentColor" stroke="none" /></g>,
  // 일차함수
  line: <g transform="translate(-2 1)"><path d="M26 12v54h72" /><path d="M34 60 98 20" /><circle cx="58" cy="45" r="4" fill="currentColor" stroke="none" /></g>,
  // 기울기·변화율
  slope: <g transform="translate(0 -2)"><path d="M20 64 100 20" /><path d="M48 46v18h32" strokeWidth="1.5" strokeDasharray="4 4" /><path d="M52 58h6M76 58v6" strokeWidth="1.4" /></g>,
  // 이차함수
  parabola: <g transform="translate(-2 1)"><path d="M26 12v54h72" /><path d="M36 18C44 62 76 62 92 18" fill="none" /><circle cx="64" cy="57" r="4" fill="currentColor" stroke="none" /></g>,
  // 각·평행
  angle: <g transform="translate(-3 -4)"><path d="M22 64 104 64M22 64 92 24" /><path d="M52 64a30 30 0 0 0-2-12" strokeWidth="1.5" /></g>,
  // 다각형
  polygon: <g transform="translate(0 -3)"><path d="M60 14 102 44 86 72H34L18 44Z" /><path d="M60 14 60 72M18 44h84" strokeWidth="1.2" strokeDasharray="4 4" /></g>,
  // 삼각형
  triangle: <g transform="translate(-2 -3)"><path d="M28 66 28 20 96 66Z" /><path d="M28 56h10v10" strokeWidth="1.4" /></g>,
  // 닮음
  similar: <g transform="translate(-1 -2)"><path d="M18 66 18 38 52 66Z" /><path d="M62 66 62 18 104 66Z" /></g>,
  // 원
  circle: <g transform="translate(0 -2)"><circle cx="60" cy="42" r="30" /><path d="M60 42 88 30"  /><circle cx="60" cy="42" r="3.5" fill="currentColor" stroke="none" /></g>,
  // 입체도형
  solid: <g transform="translate(2 0)"><path d="M28 30h44v32H28Z" /><path d="M28 30 44 18h44l-16 12M72 62l16-12V18" /><path d="M44 18v32h44" strokeWidth="1.3" strokeDasharray="3 4" /></g>,
  // 겉넓이·부피
  volume: <g transform="translate(-8.8 -1)"><path d="M30 26v30c0 6 14 10 30 10s30-4 30-10V26" /><ellipse cx="60" cy="26" rx="30" ry="10" /><path d="M104 22v40M100 22h8M100 62h8" strokeWidth="1.4" /></g>,
  // 통계·자료
  histogram: <g transform="translate(-2 -3.5)"><path d="M26 62V38M40 62V30M54 62V46M68 62V24M82 62V42M96 62V34" strokeWidth="6" strokeLinecap="butt" opacity=".9" /><path d="M18 62h88" strokeWidth="2" /></g>,
  // 산포도·상관
  scatter: <g transform="translate(-4 1)"><path d="M22 12v54h84" /><path d="M30 60 100 24" strokeWidth="1.4" strokeDasharray="5 4" /><g fill="currentColor" stroke="none"><circle cx="38" cy="58" r="3.4" /><circle cx="50" cy="48" r="3.4" /><circle cx="58" cy="52" r="3.4" /><circle cx="70" cy="38" r="3.4" /><circle cx="80" cy="34" r="3.4" /><circle cx="92" cy="24" r="3.4" /></g></g>,
  // 확률
  probability: <g transform="translate(-1 -4)"><rect x="16" y="24" width="40" height="40" rx="6" /><g fill="currentColor" stroke="none"><circle cx="27" cy="35" r="3.6" /><circle cx="36" cy="44" r="3.6" /><circle cx="45" cy="53" r="3.6" /></g><rect x="66" y="24" width="40" height="40" rx="6" /><g fill="currentColor" stroke="none"><circle cx="77" cy="35" r="3.6" /><circle cx="95" cy="35" r="3.6" /><circle cx="77" cy="53" r="3.6" /><circle cx="95" cy="53" r="3.6" /></g></g>,
  // 경우의 수
  tree: <g transform="translate(9.4 -2)"><path d="M24 42h14M38 42 58 24M38 42 58 60M58 24 78 16M58 24 78 32M58 60 78 52M58 60 78 68" /><circle cx="20" cy="42" r="4.5" fill="currentColor" stroke="none" /><g fill="currentColor" stroke="none"><circle cx="82" cy="16" r="3.6" /><circle cx="82" cy="32" r="3.6" /><circle cx="82" cy="52" r="3.6" /><circle cx="82" cy="68" r="3.6" /></g></g>,
  // 집합·명제
  set: <g transform="translate(0 -2)"><circle cx="46" cy="42" r="26" /><circle cx="74" cy="42" r="26" /><path d="M60 20a26 26 0 0 0 0 44 26 26 0 0 0 0-44" fill="currentColor" stroke="none" opacity=".8" /></g>,
  // 삼각비
  // 갈래를 알 수 없을 때 — 풀어 둔 문제지 한 묶음
  general: <g transform="translate(2 -1)"><rect x="22" y="22" width="60" height="46" rx="3" /><rect x="34" y="14" width="60" height="46" rx="3" fill="#fffdf8" /><path d="M46 28h36M46 40h36M46 52h20" strokeWidth="1.6" /></g>,
  trig: <g transform="translate(0 -3)"><path d="M20 66 100 66 100 20Z" /><path d="M52 66a32 32 0 0 0 0-18" strokeWidth="1.6" /><path d="M100 54H88v12" strokeWidth="1.3" /><path d="M100 20 100 66" strokeWidth="4.2" /></g>,
};

// Which stems wear which drawing. tests/lesson-marks.test.ts checks this against the catalogue, so
// a course added with an unfamiliar key is caught here rather than silently drawing the fallback.
const MARK_BY_STEM: Record<string, keyof typeof LESSON_MARKS> = Object.fromEntries(([
  ['fraction', 'fraction rational repeating'],
  ['decimal', 'decimal'],
  ['ratio', 'ratio direct inverse'],
  ['percent', 'percentage'],
  ['factor', 'prime gcd common factor factorization remainder composite multiplication'],
  ['negative', 'negative absolute signed'],
  ['root', 'square irrational radical imaginary complex'],
  ['power', 'exponent monomial polynomial'],
  ['variable', 'variable expression substitution elimination'],
  ['equation', 'equation equality linear two simultaneous root'],
  ['inequality', 'inequality'],
  ['axes', 'coordinate distance plane'],
  ['line', 'function line'],
  ['slope', 'slope'],
  ['parabola', 'parabola quadratic completing'],
  ['angle', 'angle parallel construction'],
  ['polygon', 'polygon parallelogram special'],
  ['triangle', 'triangle isosceles pythagoras'],
  ['similar', 'similar centroid'],
  ['circle', 'circle sector inscribed'],
  ['solid', 'polyhedron solid'],
  ['volume', 'surface volume'],
  ['histogram', 'frequency histogram relative representative ncs'],
  ['scatter', 'variance scatter'],
  ['probability', 'probability'],
  ['tree', 'counting permutation combination'],
  ['set', 'set proposition always'],
  ['trig', 'trig'],
] as const).flatMap(([mark, stems]) => stems.split(' ').map((stem) => [stem, mark])));

function LessonArt({ lessonKey = '', large = false, small = false }: { lessonKey?: string; large?: boolean; small?: boolean }) {
  const mark = MARK_BY_STEM[lessonKey.split('-')[0]] ?? 'general';
  // Only the tilt is left to chance — enough that a row of cards does not look stamped, little
  // enough that nothing reads as crooked.
  const tilt = [...lessonKey].reduce((hash, letter) => (hash * 31 + letter.codePointAt(0)!) % 100003, 7);
  return <div className={`class-art art-${tilt % 3}${large ? ' large' : ''}${small ? ' small' : ''}`} aria-hidden="true">
    <svg className="lesson-mark" viewBox="0 0 120 80" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${(tilt % 5) - 2}deg)` }}>
      {LESSON_MARKS[mark]}
    </svg>
  </div>;
}


function LessonCard({ item, index, courseTitle, enrollment, onOpen }: { item: PublicLesson; index: number; courseTitle: string; enrollment?: EnrollmentView; onOpen: () => void }) {
  const completed = enrollment?.status === 'completed';
  const percent = Math.min(100, Math.round((enrollment?.completedSectionIds.length ?? 0) / Math.max(1, item.sectionCount) * 100));
  return <button className="class-card" onClick={onOpen}>
    <LessonArt lessonKey={item.lessonKey} />
    <div className="class-card-content"><div className="class-card-meta"><span>{courseTitle} · {String(index + 1).padStart(2, '0')}</span>{completed && <span className="completed-label"><Icon name="check" size={13} />완료</span>}</div>
      <h3>{item.title}</h3><p>{item.summary}</p>
      <div className="class-card-footer"><span><Icon name="clock" size={14} />{item.estimatedMinutes}분 <i />{item.sectionCount}개 단계</span><Icon name="arrow" size={18} /></div>
      {enrollment && <div className="card-progress" aria-label={`진도 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>}
    </div>
  </button>;
}

export function LearningWorkspace() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<Session | null>(null);
  const authenticatedUserId = useRef<string | null>(null);
  const [state, setState] = useState<LearningState | null>(null);
  const [catalog, setCatalog] = useState<PublicLesson[]>([]);
  const [courses, setCourses] = useState<PublicCourse[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string>('all');
  /**
   * Whether the lessons screen shows the courses this learner has a reason to look at or the whole
   * catalogue. `null` until they say so, and then it is 「내 과정」 for anybody who has told us
   * something and 「전체」 for a visitor who has not — browsing is what a visitor came to do.
   */
  const [lessonScope, setLessonScope] = useState<'mine' | 'all' | null>(null);
  /** What a learner typed to find a lesson by name. A search always reaches the whole catalogue. */
  const [lessonSearch, setLessonSearch] = useState('');
  /** Courses the learner opened or shut by hand, over whatever the screen would have done itself. */
  const [courseToggles, setCourseToggles] = useState<Record<string, boolean>>({});
  const [taughtConcepts, setTaughtConcepts] = useState<PublicConcept[]>([]);
  const [problemSets, setProblemSets] = useState<PublicProblemSet[]>([]);
  /**
   * Which courses on the shelf are open, and where to land once it is drawn.
   *
   * A course used to close when another opened, which made the shelf a place that showed one thing
   * and hid the rest. Several may stand open now, because a learner who came looking for a set is
   * usually comparing them. `shelfTarget` is the way in from elsewhere: a course, and the lesson
   * inside it when the learner arrived from that lesson rather than from the course.
   */
  const [openShelves, setOpenShelves] = useState<string[]>([]);
  const [shelfTarget, setShelfTarget] = useState<{ courseKey: string; lessonKey: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [webAuthentication, setWebAuthentication] = useState(false);
  const [googleStarting, setGoogleStarting] = useState(false);
  const googleStartingRef = useRef(false);
  const loadGeneration = useRef(0);
  const authReturn = useRef<{ message: string | null; returnTo: AuthReturn | null } | null>(null);
  const [document, setDocument] = useState<LessonDocument | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const lessonRequest = useRef(0);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [selectedAssignment, setSelectedAssignment] = useState<string | null>(null);
  const [finishedLesson, setFinishedLesson] = useState(false);
  const [modal, setModal] = useState<'login' | 'profile' | 'welcome' | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [target, setTarget] = useState<string>('');
  const [minutes, setMinutes] = useState(10);
  const [dirtyProblems, setDirtyProblems] = useState<string[]>([]);
  /** The question to put in front of the learner once the screen has been redrawn, by its number. */
  const [problemToShow, setProblemToShow] = useState<number | null>(null);
  /**
   * Whether the first load has read the address yet. Until it has, the screen says 「내 학습」 while
   * the address may say a lesson — writing then would throw away the link that was followed.
   */
  const [landed, setLanded] = useState(false);
  const wrote = useRef<string | null>(null);
  /** Whether the learner went somewhere themselves while the first load was still running. */
  const moved = useRef(false);
  /** Whether the profile dialog is asking about deletion rather than about what to learn. */
  const [erasing, setErasing] = useState(false);
  /** Whether this account has already been asked what it came for. See the effect that sets it. */
  const welcomeOffered = useRef(false);
  const [notice, setNotice] = useState('');
  const submissionRequests = useRef(new Map<string, string>());
  const modalRef = useRef<HTMLDivElement>(null);
  const modalReturnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (problemToShow === null) return;
    setProblemToShow(null);
    showProblem(problemToShow);
  }, [problemToShow]);

  // Landing on the shelf, once the course asked for has been drawn open. The group takes the
  // cursor as well as the screen, so a learner reading with the keyboard arrives where the eye does.
  useEffect(() => {
    if (!shelfTarget) return;
    setShelfTarget(null);
    const group = window.document.getElementById(shelfGroupId(shelfTarget.courseKey, shelfTarget.lessonKey))
      ?? window.document.getElementById(shelfGroupId(shelfTarget.courseKey, null));
    if (!group) return;
    group.scrollIntoView({ block: 'start', behavior: 'smooth' });
    group.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus({ preventScroll: true });
  }, [shelfTarget]);

  useEffect(() => {
    if (!modal) return;
    modalReturnFocus.current = window.document.activeElement as HTMLElement;
    const dialog = modalRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setModal(null);
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (event.shiftKey && window.document.activeElement === elements[0]) { event.preventDefault(); elements.at(-1)?.focus(); }
      if (!event.shiftKey && window.document.activeElement === elements.at(-1)) { event.preventDefault(); elements[0]?.focus(); }
    };
    window.document.addEventListener('keydown', onKey);
    return () => { window.document.removeEventListener('keydown', onKey); modalReturnFocus.current?.focus(); };
  }, [modal]);

  function clearPersonalState() {
    authenticatedUserId.current = null;
    // Whoever arrives next is somebody else, and has not been asked anything yet.
    welcomeOffered.current = false;
    setState(null);
    setSession((previous) => previous ? { ...previous, user: null } : null);
    setSelectedAssignment(null); setDirtyProblems([]); setOpenShelves([]); submissionRequests.current.clear();
    lessonRequest.current += 1; setDocument(null); setLessonLoading(false);
    setSectionIndex(0); setFinishedLesson(false); setDisplayName('');
    setTarget(''); setMinutes(10); setModal(null); setPage('home');
    // 「내 과정」 and the courses held open belong to an account, not to a tab.
    setLessonScope(null); setLessonSearch(''); setCourseToggles({});
    if (authReturn.current) authReturn.current.returnTo = null;
    try { clearAuthReturn(window.sessionStorage); } catch { /* Browser storage may be restricted. */ }
  }

  async function refresh(restoreAfterLogin = false) {
    const generation = ++loadGeneration.current;
    setLoading(true); setError('');
    try {
      const nextSession = await learningApi.session();
      if (generation !== loadGeneration.current) return;
      // A pageshow listener keeps its initial closure; compare the confirmed account via a ref.
      // Clear the old account before fetching more data, even if the new account's load fails.
      if (authenticatedUserId.current && authenticatedUserId.current !== nextSession.user?.id) clearPersonalState();
      authenticatedUserId.current = nextSession.user?.id ?? null;
      setSession(nextSession);
      const [publicCatalog, nextState] = await Promise.all([
        learningApi.catalog(),
        nextSession.user ? learningApi.state() : Promise.resolve(null),
      ]);
      if (generation !== loadGeneration.current) return;
      assertLearningResponseAccount(
        { userId: nextSession.user?.id ?? null, generation },
        { userId: authenticatedUserId.current, generation: loadGeneration.current },
        nextState?.user.id ?? null,
      );
      setCatalog(publicCatalog.lessons); setCourses(publicCatalog.courses.map(onATrack)); setTaughtConcepts(publicCatalog.concepts); setProblemSets(publicCatalog.problemSets); setState(nextState);
      const pending = authReturn.current;
      const hasAuthDestination = !!pending?.returnTo;
      if (restoreAfterLogin && pending?.returnTo && (nextState || pending.message)) {
        // Stored content keys are only used after matching the public catalogue, never as URLs.
        if (publicCatalog.lessons.some((item) => item.lessonKey === pending.returnTo?.lessonKey)) {
          await openLesson(pending.returnTo.lessonKey, nextState);
        }
        if (generation !== loadGeneration.current) return;
        if (nextState) {
          try { clearAuthReturn(window.sessionStorage); } catch { /* Navigation metadata is optional. */ }
          pending.returnTo = null;
        }
      }
      // Nothing is restored over somebody: a learner who pressed something while this was loading
      // is where they meant to be, and an address is only ever how they arrived.
      if (restoreAfterLogin && !hasAuthDestination && !moved.current) {
        // What the address asks for, once there is a catalogue to match it against. A lesson has to
        // be one that exists and a run one of this learner's own; anything else is a link that has
        // gone stale, and the screen it names stands in for it rather than an error.
        const asked = readPlace(window.location.search);
        if (asked.page === 'lesson' && asked.lessonKey) {
          if (publicCatalog.lessons.some((lesson) => lesson.lessonKey === asked.lessonKey)) await openLesson(asked.lessonKey, nextState, asked.step);
          else setPage('lessons');
        } else if (asked.page === 'assignment') {
          if (nextState?.assignments.some((entry) => entry.recipientId === asked.recipientId)) { setDirtyProblems([]); setSelectedAssignment(asked.recipientId ?? null); setPage('assignment'); }
          else setPage('practice');
        } else if (asked.page !== 'home') setPage(asked.page);
        // 「내 학습」 is where the screen already is, so a bare address restores nothing — and a
        // learner who pressed something while this was still loading stays where they pressed.
      }
      if (restoreAfterLogin && pending?.message) { setAuthError(pending.message); setModal('login'); }
    } catch (reason) {
      if (generation !== loadGeneration.current) return;
      if (reason instanceof LearningResponseError && reason.kind === 'stale') return;
      if ((reason instanceof ApiError && reason.status === 401) || reason instanceof LearningResponseError) clearPersonalState();
      setError(messageOf(reason));
    } finally {
      // A load that has been overtaken says nothing about anything, least of all about where the
      // learner is: handing the address to the screen here would let it write 「내 학습」 over the
      // link the newer load has not read yet. React mounts twice in development, which is exactly
      // that pair of loads.
      if (generation === loadGeneration.current) {
        setLoading(false);
        // Whatever came of it, the address is now the screen's to keep — including when the load
        // failed, so that moving around afterwards still leaves a trail to walk back through.
        if (restoreAfterLogin) setLanded(true);
      }
    }
  }

  useEffect(() => {
    const bridge = (window as Window & { Capacitor?: Parameters<typeof isNativeBrowser>[0] }).Capacitor;
    setWebAuthentication(supportsWebAuthentication(window.location.origin, isNativeBrowser(bridge)));
    if (!authReturn.current) {
      const returned = parseAuthError(window.location.search);
      let returnTo: AuthReturn | null = null;
      try { returnTo = readAuthReturn(window.sessionStorage); } catch { /* Storage may be unavailable. */ }
      authReturn.current = { message: returned?.message ?? null, returnTo };
      if (returned) {
        setAuthError(returned.message); setModal('login');
        // Only remove our own error parameter; preserve the current same-origin path, query and hash.
        try {
          const currentUrl = new URL(window.location.href);
          currentUrl.search = returned.cleanSearch;
          window.history.replaceState(window.history.state, '', currentUrl.href);
        } catch { /* The allowlisted message still works if this browser restricts history changes. */ }
      }
    }
    void refresh(true);
    const onPageShow = (event: PageTransitionEvent) => {
      googleStartingRef.current = false; setGoogleStarting(false);
      if (event.persisted) void refresh();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => { loadGeneration.current += 1; window.removeEventListener('pageshow', onPageShow); };
  }, []);

  function beginGoogleLogin() {
    if (!session?.googleLogin || !webAuthentication || busyRef.current || googleStartingRef.current) return;
    try { saveAuthReturn(window.sessionStorage, page === 'lesson' ? document?.lessonKey ?? null : null); }
    catch { /* OAuth can continue without optional lesson navigation metadata. */ }
    googleStartingRef.current = true; setGoogleStarting(true); setAuthError(''); setError('');
    window.location.assign(GOOGLE_LOGIN_PATH);
  }

  const reviewConceptKeys = state?.plan.readiness.filter((item) => item.readiness === 'needs-practice').map((item) => item.key) ?? [];
  function navigate(next: Page) { moved.current = true; setPage(next); setNotice(''); setError(''); window.scrollTo({ top: 0, behavior: 'instant' }); }
  /**
   * Where the screen stands, as an address can tell it. A lesson or a set still being fetched is
   * nowhere yet — it has no key to write — so the address is left as it was until it arrives, and
   * a lesson that fails to open leaves the last good address behind rather than a broken one.
   */
  function standing(): Place | null {
    if (page === 'lesson') return document ? { page: 'lesson', lessonKey: document.lessonKey, step: sectionIndex + 1 } : null;
    if (page === 'assignment') return selectedAssignment ? { page: 'assignment', recipientId: selectedAssignment } : null;
    return { page };
  }
  /**
   * The address follows the screen rather than driving it: every way in already sets the screen,
   * and there are many of them, so one place writes what they all arrived at. Going somewhere adds
   * an entry to walk back through; moving within the same work replaces it (see `sameWork`).
   */
  useEffect(() => {
    if (!landed) return;
    const here = standing();
    if (!here) return;
    const written = placeSearch(here);
    if (written === window.location.search) { wrote.current = written; return; }
    try {
      const url = `${window.location.pathname}${written}${window.location.hash}`;
      if (wrote.current !== null && sameWork(readPlace(wrote.current), here)) window.history.replaceState(window.history.state, '', url);
      else window.history.pushState(null, '', url);
    } catch { /* A browser that refuses history keeps the screen; only the address stops following. */ }
    wrote.current = written;
  });
  /**
   * Walking back to where the address now points, without writing anything: the browser has
   * already moved, and the screen is catching up. What it names is checked before it is opened —
   * a lesson against the catalogue, a run against the learner's own.
   */
  async function land(place: Place) {
    setNotice(''); setError('');
    if (place.page === 'lesson' && place.lessonKey) {
      if (place.lessonKey === document?.lessonKey) { setPage('lesson'); setFinishedLesson(false); setSectionIndex(Math.max(0, (place.step ?? 1) - 1)); return; }
      if (lessons.some((lesson) => lesson.lessonKey === place.lessonKey)) { await openLesson(place.lessonKey, state, place.step); return; }
      navigate('lessons'); return;
    }
    if (place.page === 'assignment') {
      if (state?.assignments.some((entry) => entry.recipientId === place.recipientId)) {
        setDirtyProblems([]); setSelectedAssignment(place.recipientId ?? null); navigate('assignment'); return;
      }
      navigate('practice'); return;
    }
    navigate(place.page);
  }
  const landing = useRef(land);
  useEffect(() => { landing.current = land; });
  useEffect(() => {
    const onPop = () => { void landing.current(readPlace(window.location.search)); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  /**
   * Asking a learner who has just arrived what they came for.
   *
   * 「배우려는 과정」 is the strongest thing this service knows about somebody, and it used to be
   * asked for only by a button in the sidebar that a new learner has no reason to press. Empty, it
   * makes everyone the same person — the placement covers the whole school line and the
   * recommendation falls back to the catalogue's own order — so whatever they came for, they were
   * handed 분수 1강 and left to work out that anything else was possible.
   *
   * It is offered once, and 「once」 is counted from the offer rather than from an answer: somebody
   * who closed it has answered by closing it, and being asked again every morning is nagging. The
   * sidebar still opens the same settings whenever they do want to say.
   */
  useEffect(() => {
    if (welcomeOffered.current || !state || !landed || loading || busy || modal || page !== 'home') return;
    // Anybody who has told us anything at all — a course, a lesson, a placement — is not new here.
    if (state.user.targetCourseKey || state.enrollments.length || state.diagnostic) return;
    const key = `gm.first-step.${state.user.id}`;
    try { if (window.localStorage.getItem(key)) return; window.localStorage.setItem(key, 'asked'); }
    catch { /* Browser storage may be restricted; then it is offered again on the next visit. */ }
    welcomeOffered.current = true;
    setModal('welcome');
  }, [state, landed, loading, busy, modal, page]);

  const lessons = state?.lessons ?? catalog;
  // Catalogue copy names the concepts the published lessons teach, so new subjects need no edit here.
  const conceptLabels = taughtConcepts.map((concept) => concept.label);
  const heroIntro = (conceptLabels.length > 1 ? `${conceptLabels[0]}부터 ${conceptLabels.at(-1)}까지.\n`
    : conceptLabels.length === 1 ? `${conceptLabels[0]}부터 차근차근.\n` : '') + '짧은 설명과 직접 푸는 연습으로 다시 만나요.';
  const currentEnrollment = state?.enrollments.find((entry) => entry.lessonKey === document?.lessonKey);
  const assignment = state?.assignments.find((entry) => entry.recipientId === selectedAssignment);
  const completedCount = state?.enrollments.filter((entry) => entry.status === 'completed').length ?? 0;
  const pendingAssignments = state?.assignments.filter((entry) => entry.status === 'assigned') ?? [];
  const recommended = lessons.find((item) => item.lessonKey === state?.recommendations[0]?.lessonKey) ?? lessons.find((item) => !state?.enrollments.some((entry) => entry.lessonKey === item.lessonKey && entry.status === 'completed')) ?? lessons[0];
  const activeNav = page === 'lesson' ? 'lessons' : page === 'assignment' ? 'practice' : page === 'diagnostic' ? 'home' : page;

  const dispatch: Dispatch = async (action) => {
    if (busyRef.current) throw new Error('앞선 요청을 저장하고 있어요. 잠시 기다려 주세요.');
    if (loading) throw new Error('학습 공간을 새로 불러오고 있어요. 잠시 기다려 주세요.');
    const requestAccount = { userId: authenticatedUserId.current, generation: loadGeneration.current };
    if (!requestAccount.userId) throw new Error('학습 공간을 새로 불러온 뒤 다시 시도해 주세요.');
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const response = await learningApi.action(action, requestAccount.userId);
      assertLearningResponseAccount(requestAccount,
        { userId: authenticatedUserId.current, generation: loadGeneration.current }, response.state.user.id);
      setState(response.state); return response;
    }
    catch (reason) {
      // A previous tab/account's late success or failure cannot overwrite the current account.
      if (requestAccount.generation !== loadGeneration.current || requestAccount.userId !== authenticatedUserId.current) throw reason;
      if ((reason instanceof ApiError && reason.code === 'account_changed') || (reason instanceof LearningResponseError && reason.kind === 'account-changed')) {
        clearPersonalState(); void refresh(); setNotice(messageOf(reason)); throw reason;
      }
      if (reason instanceof ApiError && reason.status === 401) { clearPersonalState(); setModal('login'); }
      setError(messageOf(reason)); throw reason;
    } finally { busyRef.current = false; setBusy(false); }
  };

  /**
   * Opens a lesson. Where to start reading is the lesson's own answer — the first step not yet
   * finished — unless an address asked for a step, which is a learner coming back to where they
   * were rather than opening the lesson afresh.
   */
  async function openLesson(key: string, learningState = state, step?: number) {
    const requestId = ++lessonRequest.current;
    navigate('lesson'); setLessonLoading(true); setDocument(null); setFinishedLesson(false);
    try {
      const nextDocument = await learningApi.lesson(key);
      if (requestId !== lessonRequest.current) return;
      setDocument(nextDocument);
      const enrollment = learningState?.enrollments.find((entry) => entry.lessonKey === key);
      const firstIncomplete = nextDocument.sections.findIndex((section) => !enrollment?.completedSectionIds.includes(section.sectionId));
      if (step) { setSectionIndex(Math.min(Math.max(0, step - 1), nextDocument.sections.length - 1)); return; }
      setSectionIndex(enrollment?.status === 'completed' ? 0 : Math.max(0, firstIncomplete));
    } catch (reason) { if (requestId === lessonRequest.current) setError(messageOf(reason)); }
    finally { if (requestId === lessonRequest.current) setLessonLoading(false); }
  }
  async function startLesson() {
    if (!document) return;
    if (!state) { setModal('login'); return; }
    try {
      const response = await dispatch({ action: 'enrollment.start', lessonKey: document.lessonKey });
      const enrolled = response.state.enrollments.find((entry) => entry.lessonKey === document.lessonKey);
      // A lesson may have been republished since its public preview was opened.
      if (enrolled && enrolled.lessonVersionId !== document.versionId) await openLesson(document.lessonKey);
      setSectionIndex(0); setNotice('수업을 시작했어요. 나의 속도로 한 단계씩 배워보세요.');
    }
    catch { /* The shared error banner retains the server message. */ }
  }
  async function nextSection() {
    if (!document) return;
    const section = document.sections[sectionIndex];
    if (!currentEnrollment) { if (sectionIndex < document.sections.length - 1) setSectionIndex((value) => value + 1); return; }
    if (currentEnrollment.status === 'completed') { if (sectionIndex < document.sections.length - 1) setSectionIndex((value) => value + 1); else navigate('home'); return; }
    try {
      await dispatch({ action: 'section.complete', enrollmentId: currentEnrollment.id, sectionId: section.sectionId });
      if (sectionIndex < document.sections.length - 1) { setSectionIndex((value) => value + 1); window.scrollTo({ top: 0, behavior: 'instant' }); }
      else { await dispatch({ action: 'lesson.complete', enrollmentId: currentEnrollment.id }); setFinishedLesson(true); window.scrollTo({ top: 0, behavior: 'instant' }); }
    } catch { /* Completion only advances after the server accepted the action. */ }
  }
  function openAssignment(item: AssignmentView) { setDirtyProblems([]); setSelectedAssignment(item.recipientId); navigate('assignment'); }
  /**
   * Gathers the questions built to catch one mistake and opens them. Like starting a set: the run
   * that comes back may be one already open, because coming back means 「이어서」.
   */
  async function gatherPractice(misconception: string) {
    if (!state) { setModal('login'); return; }
    try {
      const response = await dispatch({ action: 'practice.gather', misconception });
      if (!response.recipientId) return;
      setDirtyProblems([]); setSelectedAssignment(response.recipientId); navigate('assignment');
    } catch { /* dispatch has already said what went wrong. */ }
  }
  /** Opens a problem set on its own. The run that comes back may be one already in progress. */
  async function startProblemSet(problemSetId: string) {
    if (!state) { setModal('login'); return; }
    try {
      const response = await dispatch({ action: 'problemSet.start', problemSetId });
      if (!response.recipientId) return;
      setDirtyProblems([]); setSelectedAssignment(response.recipientId); navigate('assignment');
    } catch { /* dispatch has already said what went wrong. */ }
  }
  /**
   * The way into a course's problem sets from the course itself, or from a lesson inside it.
   *
   * A set belongs to a course and is shown by a lesson's step, so until now the only door was the
   * shelf at the far end of 연습장 — a learner had to already know the sets were there to go and
   * look for them. Every place that names a course or a lesson can open this one instead.
   */
  function openCourseSets(courseKey: string, lessonKey: string | null = null) {
    setOpenShelves((previous) => previous.includes(courseKey) ? previous : [...previous, courseKey]);
    navigate('practice');
    setShelfTarget({ courseKey, lessonKey });
  }
  async function submitAssignment() {
    if (!assignment || dirtyProblems.length) return;
    const requestId = submissionRequests.current.get(assignment.recipientId) ?? crypto.randomUUID();
    submissionRequests.current.set(assignment.recipientId, requestId);
    const own = assignment.policy.kind === 'practice';
    try { await dispatch({ action: 'assignment.submit', recipientId: assignment.recipientId, requestId }); submissionRequests.current.delete(assignment.recipientId);
      setNotice(own ? '문제집을 다 풀었어요. 풀이 결과는 학습 기록에도 남아요.' : '과제를 제출했어요. 풀이 결과는 학습 기록에서 확인할 수 있어요.'); }
    catch { /* Keep the same idempotency key for retries. */ }
  }
  async function login(event: FormEvent) {
    event.preventDefault(); if (busyRef.current || !webAuthentication || !session?.developmentLogin) return;
    busyRef.current = true; setBusy(true); setError(''); setAuthError('');
    const generation = ++loadGeneration.current;
    try {
      const nextSession = await learningApi.login(displayName.trim() || '학습자');
      if (generation !== loadGeneration.current) return;
      authenticatedUserId.current = nextSession.user?.id ?? null;
      setSession((previous) => ({ user: nextSession.user, developmentLogin: previous?.developmentLogin ?? false, googleLogin: previous?.googleLogin ?? false }));
      const nextState = await learningApi.state();
      assertLearningResponseAccount({ userId: nextSession.user?.id ?? null, generation },
        { userId: authenticatedUserId.current, generation: loadGeneration.current }, nextState.user.id);
      setState(nextState); setModal(null); setNotice('학습 공간이 준비됐어요. 첫 수업을 시작해 보세요.');
    }
    catch (reason) {
      if (generation !== loadGeneration.current || (reason instanceof LearningResponseError && reason.kind === 'stale')) return;
      if (reason instanceof LearningResponseError || (reason instanceof ApiError && reason.status === 401)) clearPersonalState();
      setError(messageOf(reason));
    }
    finally { busyRef.current = false; setBusy(false); if (generation === loadGeneration.current) setLoading(false); }
  }
  /**
   * Leaving for good. What goes is said before it goes, and the same shared state that a logout
   * clears is cleared here too — with the difference that there is nothing to come back to.
   */
  async function eraseAccount() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); loadGeneration.current += 1;
    try {
      await learningApi.deleteAccount();
      clearPersonalState(); setErasing(false); setAuthError(''); navigate('home');
      setNotice('계정과 학습 기록을 지웠어요. 그동안 함께해 주셔서 고마워요.');
    }
    catch (reason) { setError(messageOf(reason)); }
    finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }
  async function logout() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); loadGeneration.current += 1;
    try {
      await learningApi.logout(); clearPersonalState(); setAuthError(''); navigate('home');
      setNotice('로그아웃했어요. 다시 로그인하면 저장한 학습을 이어갈 수 있어요.');
    }
    catch (reason) { setError(messageOf(reason)); }
    finally { busyRef.current = false; setBusy(false); setLoading(false); }
  }
  function openProfile() {
    setErasing(false);
    if (!state) { setModal('login'); return; }
    setTarget(state.user.targetCourseKey ?? ''); setMinutes(state.user.dailyMinutes); setModal('profile');
  }
  /** The first-step dialog's answer, which is the same profile the sidebar edits, asked differently. */
  async function saveFirstStep(choice: { targetCourseKey: string | null; dailyMinutes: number }) {
    try {
      await dispatch({ action: 'profile.update', targetCourseKey: choice.targetCourseKey, dailyMinutes: choice.dailyMinutes });
      setModal(null);
      setNotice(choice.targetCourseKey
        ? '배우려는 과정을 반영했어요. 시작점 확인은 거기까지 가는 데 필요한 것만 물어요.'
        : '하루 학습 시간을 반영했어요. 배우려는 과정은 언제든 왼쪽 아래에서 고를 수 있어요.');
    } catch { /* Shown in dialog and page. */ }
  }
  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    try { await dispatch({ action: 'profile.update', targetCourseKey: target || null, dailyMinutes: minutes }); setModal(null); setNotice('배우려는 과정과 시간을 반영했어요. 다음 추천과 새 복습 과제에 적용하며, 이미 받은 과제는 그대로 유지해요.'); } catch { /* Shown in dialog and page. */ }
  }

  const courseTitle = (item: PublicLesson) => courses.find((course) => course.key === item.courseKey)?.title ?? '수업';
  /**
   * Whose mark a problem set wears. A set the learner opened is carried as a piece of work with no
   * lesson of its own, so the catalogue is asked which lesson shows it; a set no lesson shows falls
   * back to its own name, which at least keeps it the same drawing every time it is listed.
   */
  const setArtKey = (problemSetId: string | null, lessonKey: string | null = null) =>
    problemSets.find((set) => set.problemSetId === problemSetId)?.lessonKey ?? lessonKey ?? problemSetId ?? 'gathered';
  const courseIndex = (item: PublicLesson) => lessons.filter((lesson) => lesson.courseKey === item.courseKey).findIndex((lesson) => lesson.lessonKey === item.lessonKey);
  function assignmentRow(item: AssignmentView) {
    const savedCount = item.items.filter((entry) => entry.attempt).length;
    // A set the learner picked wears the same mark it wore on the shelf, so it is recognisable as
    // the thing they chose. Work somebody else issued keeps the icon that says what it is.
    return <button key={item.recipientId} className="assignment-row" onClick={() => openAssignment(item)}>{item.policy.kind === 'practice'
      ? <LessonArt lessonKey={setArtKey(item.problemSetId, item.lessonKey)} small />
      : <span className="assignment-icon"><Icon name={item.status === 'submitted' ? 'check' : 'pencil'} size={23} /></span>}<span className="assignment-info"><strong>{item.title}</strong><small>{assignmentKindLabel[item.policy.kind]} · {item.items.length}문제 · {assignmentTiming(item)}</small>{item.lessonKey && <small>{lessons.find((lesson) => lesson.lessonKey === item.lessonKey)?.title}</small>}</span><span className={`assignment-status ${item.status}`}>{item.status === 'submitted' ? '제출 완료' : savedCount ? `${savedCount}/${item.items.length} 저장` : '풀어보기'}</span><Icon name="chevron" size={18} /></button>;
  }

  /**
   * The one thing to do now.
   *
   * The home screen used to lay eight invitations side by side — a recommended lesson, a placement,
   * a lesson to pick instead, a way back to automatic recommendations, the reasoning behind them,
   * a review, a problem set, the whole catalogue — all at the same weight. To somebody with no
   * record yet they read as eight equally good ideas, which is the same as no idea at all.
   *
   * So the screen picks. The order is the order the rules themselves use: work that was issued and
   * is due, then finishing what was started, then finding out where somebody is, then the lesson
   * the recommendation landed on. Everything else is still here, further down or folded away —
   * choosing for somebody is not the same as deciding for them.
   */
  function nextStep() {
    if (!state) return { eyebrow: '기초부터 다시, 내 속도로', title: '작은 조각에서\n시작하는 큰 이해', reason: heroIntro,
      caption: '나의 속도로 배우는 수학', art: recommended?.lessonKey, action: '첫 수업 둘러보기',
      note: `약 ${recommended?.estimatedMinutes ?? 15}분 · 부담 없이 한 수업`, onAct: () => setModal('login') };
    const due = state.plan.review;
    const review = due ? state.assignments.find((item) => item.recipientId === due.recipientId) : undefined;
    if (due && review) return { eyebrow: '오늘 먼저 할 것', title: review.title, reason: due.reason,
      caption: '한 번 더 떠올리기', art: setArtKey(review.problemSetId, review.lessonKey), action: '복습부터 시작하기',
      note: `${review.items.length}문제 · 늦게 풀어도 괜찮아요`, onAct: () => openAssignment(review) };
    if (state.diagnostic?.status === 'active') return { eyebrow: '하던 것 이어서', title: '시작점 확인을 이어가요',
      reason: `개념 ${state.diagnostic.scope}개 중 ${state.diagnostic.settled}개의 자리를 찾았어요. 남은 것만 마저 물어볼게요.`,
      caption: '지금 어디쯤인지', art: recommended?.lessonKey, action: '이어서 확인하기',
      note: '언제든 그만두고 나중에 이어서 할 수 있어요', onAct: () => navigate('diagnostic') };
    // Nobody who has opened a lesson is asked this: their own work says more than a placement would.
    if (!state.diagnostic && !state.enrollments.length && state.diagnosticOffering) {
      const wanted = courses.find((course) => course.key === state.user.targetCourseKey)?.title;
      return { eyebrow: '첫 걸음', title: '어디서 시작하면 편할까요?',
        reason: wanted ? `${wanted}까지 가는 데 필요한 것만 확인해요. 앞의 답에 따라 다음 문제가 달라져서 대개 몇 문제면 끝나요.`
          : '몇 문제만 풀어 보면 지금 어디쯤인지 알 수 있어요. 앞의 답에 따라 다음 문제가 달라져서 오래 걸리지 않아요.',
        caption: '지금 어디쯤인지', art: recommended?.lessonKey, action: '시작점 확인하기',
        note: '모르는 문제는 건너뛰어도 괜찮아요 · 나중에 이어서 할 수 있어요', onAct: () => navigate('diagnostic') };
    }
    if (recommended) {
      const enrollment = state.enrollments.find((entry) => entry.lessonKey === recommended.lessonKey);
      return { eyebrow: '오늘의 추천 수업', title: recommended.title, reason: state.recommendations[0]?.reason ?? heroIntro,
        caption: courseTitle(recommended), art: recommended.lessonKey,
        action: !enrollment ? '오늘의 학습 시작' : state.recommendations[0]?.kind === 'revisit' ? '설명 다시 펼치기' : '이어서 학습하기',
        note: `오늘은 ${state.recommendations[0]?.suggestedMinutes ?? state.user.dailyMinutes}분씩 · 수업 전체 ${recommended.estimatedMinutes}분`,
        onAct: () => void openLesson(recommended.lessonKey) };
    }
    return { eyebrow: '오늘의 한 걸음', title: '수업을 둘러볼까요?', reason: '아직 추천할 수업을 고르지 못했어요. 목록에서 직접 골라 시작해도 괜찮아요.',
      caption: '나의 속도로 배우는 수학', art: undefined, action: '수업 둘러보기', note: '고른 수업은 다음 추천에 반영돼요',
      onAct: () => navigate('lessons') };
  }

  function renderHome() {
    // The lessons nearest to where this person is, with the one the hero already offers left out.
    const nearby = nearbyLessons({
      lessons, enrollments: state?.enrollments ?? [], readiness: state?.plan.readiness ?? [],
      exclude: recommended?.lessonKey ?? null,
    });
    // The review the hero may already be offering is left out here, so it is not offered twice.
    const nextAssignments = nearbyAssignments({
      assignments: pendingAssignments, now: new Date(), exclude: state?.plan.review?.recipientId ?? null,
    });
    // The heading says what the first card actually is, not what the hero above it is doing.
    const shelfTitle = state?.enrollments.some((entry) => entry.lessonKey === nearby[0]?.lessonKey && entry.status === 'active')
      ? '이어서 배울 수업'
      : state?.enrollments.length ? '다음에 배울 수업' : '차근차근, 기본부터';
    const step = nextStep();
    return <>
      <div className="page-heading"><h1>{state ? `${state.user.displayName}님, 오늘도 한 걸음.` : '그냥, 다시 시작하는 수학.'}</h1><p>완벽하게 알지 못해도 괜찮아요. 작은 이해가 쌓이면 수학이 편해져요.</p></div>
      <section className="daily-hero"><div className="hero-copy"><span className="hero-eyebrow"><span />{step.eyebrow}</span><h2>{step.title}</h2><p>{step.reason}</p><button className="button hero-button" onClick={step.onAct} disabled={loading || busy}>{step.action}<Icon name="arrow" size={18} /></button><span className="hero-duration"><Icon name="clock" size={13} />{step.note}</span></div><div className="hero-art"><div className="hero-paper"><span className="paper-caption">{step.caption}</span><LessonArt lessonKey={step.art} large /><div className="paper-equation"><span>오늘은 하나만 이해해도 충분해요.</span></div></div><span className="hero-doodle">÷</span><span className="hero-dot" /></div></section>
      {/* Where they are, which is a different question from what to do next and is answered in the
          same breath. Orientation rather than an invitation: nothing here is a thing to press
          except the way to read more of it. */}
      {state && <WayThere courses={courses} lessons={lessons} readiness={state.plan.readiness} onTheWay={state.plan.onTheWay}
        targetCourseKey={state.user.targetCourseKey} onChooseTarget={openProfile} onOpenHistory={() => navigate('history')} />}
      {/* The reasoning, and the ways to overrule it. Folded because it answers a question — 「왜 이걸
          추천했지?」 — that a learner only asks after the screen has already offered something. */}
      {state && <details className="personalization-details"><summary>이 추천은 이렇게 정했어요</summary>
        <div className="personalization-body">
          <p className="muted">시작점 확인 없이 바로 시작해도 괜찮아요. 실제 풀이와 제출한 복습을 반영해 추천이 달라져요.</p>
          <div className="recommendation-choice">
            <button className="button secondary" disabled={busy} onClick={() => navigate('diagnostic')}>{state.diagnostic?.status === 'completed' ? '진단 결과 보기' : state.diagnostic ? `개념 ${state.diagnostic.settled}/${state.diagnostic.scope} · 이어서 확인` : state.diagnosticOffering ? '시작점 확인하기' : '시작점 확인 안내'}</button>
            <button className="text-button" disabled={busy} onClick={() => navigate('lessons')}>다른 수업 직접 고르기 →</button>
            {state.plan.preferredLessonKey && <button className="text-button" disabled={busy} onClick={() => { void dispatch({ action: 'recommendation.choose', lessonKey: null }).catch(() => {}); }}>자동 추천으로 돌아가기</button>}
          </div>
          <ReadinessList readiness={state.plan.readiness} explainSource />
        </div>
      </details>}
      <div className="learning-overview"><div><span className="overview-icon"><Icon name="book" size={20} /></span><span><small>나의 학습</small><strong>{completedCount}<em>개 수업 완료</em></strong></span></div><div><span className="overview-icon"><Icon name="pencil" size={20} /></span><span><small>한 번 더 생각하기</small><strong>{pendingAssignments.length}<em>개 과제 남음</em></strong></span></div><button onClick={openProfile}><span className="overview-icon orange"><Icon name="clock" size={20} /></span><span><small>꾸준함을 위한 작은 약속</small><strong>하루 {state?.user.dailyMinutes ?? 10}<em>분씩 학습</em></strong></span><Icon name="chevron" size={16} /></button></div>
      <section className="dashboard-section"><div className="section-heading"><div><h2>{shelfTitle}</h2></div><button className="text-button" onClick={() => navigate('lessons')}>전체 수업<Icon name="arrow" size={16} /></button></div><div className="class-grid">{nearby.map((item) => <LessonCard key={item.lessonKey} item={item} index={courseIndex(item)} courseTitle={courseTitle(item)} enrollment={state?.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />)}</div>{!loading && !lessons.length && <div className="empty-inline">{error ? '수업을 불러오지 못했어요. 상단에서 다시 시도해 주세요.' : '첫 번째 수업을 준비하고 있어요.'}</div>}</section>
      <section className="dashboard-section"><div className="section-heading"><div><h2>배운 것을 내 것으로</h2></div><button className="text-button" onClick={() => navigate('practice')}>연습장<Icon name="arrow" size={16} /></button></div>{nextAssignments.length ? <div className="assignment-list">{nextAssignments.map(assignmentRow)}</div> : <div className="gentle-empty"><span className="empty-drawing"><Icon name="pencil" size={28} /></span><div><h3>오늘의 이해가 내일도 남도록</h3><p>복습이 있는 수업을 마치면 여기에 과제가 모여요. 설명 없이 문제만 풀고 싶다면 문제집을 골라도 좋아요.</p></div>{problemSets.length ? <button className="text-button" disabled={busy} onClick={() => openCourseSets(courses[0]?.key ?? '')}>문제집 골라 풀기<Icon name="arrow" size={15} /></button> : <span className="small-note">한 번 더, 천천히.</span>}</div>}</section>
      <div className="page-footnote"><span>∴</span> 조금씩 이해하는 즐거움. <b>그냥수학</b></div>
    </>;
  }

  /**
   * The courses this learner has a reason to look at.
   *
   * What they said they came for, what they are in the middle of, and where the recommendation is
   * pointing — that last one because it is often a course *below* the one they came for, and it
   * would be strange for 내 학습 to offer a lesson that 수업 then hides. It is only counted once
   * something else is in the set: on its own the recommendation is the catalogue's first course,
   * which is not a thing anybody chose.
   *
   * Empty means empty. Somebody who has told us nothing is shown the catalogue, because there is
   * no 「내 과정」 to show them and browsing is what they came to do.
   */
  function myCourseKeys() {
    const keys = new Set<string>();
    if (state?.user.targetCourseKey) keys.add(state.user.targetCourseKey);
    for (const entry of state?.enrollments ?? []) {
      const lesson = lessons.find((item) => item.lessonKey === entry.lessonKey);
      if (lesson) keys.add(lesson.courseKey);
    }
    // Only a recommendation the server actually made. `recommended` falls back to the catalogue's
    // first lesson when there is none, and that is nobody's course.
    const suggested = lessons.find((item) => item.lessonKey === state?.recommendations[0]?.lessonKey);
    if (keys.size && suggested) keys.add(suggested.courseKey);
    return keys;
  }

  /**
   * The catalogue, which is thirty-eight courses and a hundred and twenty-seven lessons.
   *
   * It used to draw all of it at once — every course open, every lesson card — with a row of
   * thirty-eight chips above it as the only way to narrow anything. That is not a list somebody
   * reads; it is a list somebody scrolls past. Three things changed. What opens by default is the
   * handful of courses that are actually this learner's. A course that is not open says who it is
   * and how far through it they are, in one line, and opens when asked. And a name can be typed,
   * which is the case the chips were worst at — looking for 「이차함수」 among thirty-eight chips
   * grouped by year is worse than reading the catalogue.
   *
   * Nothing is hidden: 「전체」 is one press away and a search always reaches everything.
   */
  function renderLessons() {
    const available = courses.filter((course) => lessons.some((lesson) => lesson.courseKey === course.key));
    const mine = myCourseKeys();
    const scope = lessonScope ?? (mine.size ? 'mine' : 'all');
    const query = lessonSearch.trim().toLowerCase();
    const found = (course: PublicCourse) => course.title.toLowerCase().includes(query)
      || lessons.some((lesson) => lesson.courseKey === course.key
        && (lesson.title.toLowerCase().includes(query) || lesson.summary.toLowerCase().includes(query)));
    // A search reaches the whole catalogue whatever the scope says. Looking for something by name is
    // exactly the case where it is not among the few courses you already have.
    const shown = query ? available.filter(found)
      : scope === 'mine' ? available.filter((course) => mine.has(course.key))
      : available.filter((course) => selectedCourse === 'all' || selectedCourse === course.key || !available.some((item) => item.key === selectedCourse));
    // The catalogue is one ordered line, and anything beside it is said to be beside it rather than
    // left to look like what comes after 일차함수. With only the one line there is nothing to say.
    const lines = courseTracks.filter((track) => shown.some((course) => course.track === track));
    const split = new Set(available.map((course) => course.track)).size > 1;
    // The chips are grouped by the same lines as the catalogue under them, and from `available`
    // rather than `shown`: picking a course narrows what is listed, never what can be picked next.
    const chipLines = courseTracks.filter((track) => available.some((course) => course.track === track));
    const chip = (key: string, label: string) => <button key={key} className={selectedCourse === key ? 'active' : ''}
      aria-pressed={selectedCourse === key} onClick={() => setSelectedCourse(key)}>{label}</button>;
    // Few enough to read, this learner's own, or turned up by a search: those open by themselves.
    const opensItself = (course: PublicCourse) => shown.length <= 3 || !!query || mine.has(course.key);
    const held = (course: PublicCourse) => lessons.filter((lesson) => lesson.courseKey === course.key);
    return <><div className="page-heading"><div className="eyebrow">차근차근 이어지는 수업</div><h1>배우고 싶은 코스부터.</h1><p>코스의 순서를 따라가거나, 지금 필요한 수업을 골라 시작하세요.</p></div>
      <div className="lesson-tools">
        {mine.size > 0 && <div className="scope-toggle" role="group" aria-label="보여 줄 범위">
          <button className={scope === 'mine' && !query ? 'active' : ''} aria-pressed={scope === 'mine' && !query}
            onClick={() => { setLessonScope('mine'); setLessonSearch(''); }}>내 과정 {mine.size}</button>
          <button className={scope === 'all' || query ? 'active' : ''} aria-pressed={scope === 'all' || !!query}
            onClick={() => { setLessonScope('all'); setLessonSearch(''); }}>전체 {available.length}</button>
        </div>}
        <label className="lesson-search"><span className="sr-only">코스나 수업 이름으로 찾기</span><Icon name="search" size={17} />
          <input type="search" value={lessonSearch} placeholder="코스나 수업 이름으로 찾기"
            onChange={(event) => setLessonSearch(event.target.value)} />
          {lessonSearch && <button className="icon-button" aria-label="찾기 지우기" onClick={() => setLessonSearch('')}><Icon name="close" size={15} /></button>}
        </label>
      </div>
      {query
        ? <p className="muted small lesson-note">찾은 코스 {shown.length}개예요. 찾기는 범위와 상관없이 카탈로그 전체를 봐요.</p>
        : scope === 'mine'
        ? <p className="muted small lesson-note">배우려는 과정과 지금 배우고 있는 코스예요. 나머지 {available.length - shown.length}개는 「전체」에서 볼 수 있어요.</p>
        : null}
      {scope === 'all' && !query && available.length > 1 && <div className="course-filters" role="group" aria-label="코스 고르기">
        <div className="course-filter-line">{chip('all', '모든 코스')}{!split && available.map((course) => chip(course.key, course.title))}</div>
        {split && chipLines.map((track) => <div className="course-filter-track" key={track} role="group" aria-label={courseTrackLabels[track]}>
          <span className="course-filter-name" aria-hidden="true">{courseTrackLabels[track]}</span>
          {byStage(available, track).map((year) => <div className="course-filter-line" key={year.stage ?? track}
            role="group" aria-label={year.stage ? `${courseTrackLabels[track]} ${courseStageLabels[year.stage]}` : courseTrackLabels[track]}>
            {year.stage && <span className="course-filter-year" aria-hidden="true">{courseStageLabels[year.stage]}</span>}
            <span className="course-filter-chips">{year.courses.map((course) => chip(course.key, course.title))}</span>
          </div>)}
        </div>)}
      </div>}
      {lines.map((track) => <div className="course-track" key={track}>{split && <div className="track-heading"><h2>{courseTrackLabels[track]}</h2><p>{trackIntros[track].note}</p></div>}
      {byStage(shown, track).flatMap((year) => [
        ...(year.stage ? [<h3 className="stage-heading" key={`${track}:${year.stage}`}>{courseStageLabels[year.stage]}</h3>] : []),
        ...year.courses.map((course) => {
        const lessonsHere = held(course);
        const complete = lessonsHere.filter((lesson) => state?.enrollments.some((entry) => entry.lessonKey === lesson.lessonKey && entry.status === 'completed')).length;
        const started = lessonsHere.some((lesson) => state?.enrollments.some((entry) => entry.lessonKey === lesson.lessonKey));
        // What this course keeps besides its lessons. Said here because this is where a learner
        // looks at a course; the shelf is where they go once they know there is something to go to.
        const sets = problemSets.filter((set) => set.courseKey === course.key);
        const open = courseToggles[course.key] ?? opensItself(course);
        return <section className={open ? 'dashboard-section course-section is-open' : 'dashboard-section course-section'} key={course.key}>
          {/* The heading wraps the control rather than sitting beside it, so the course is still a
              heading to jump to and the thing that opens it is still one thing to press. */}
          <h3 className="catalog-heading"><button className="catalog-banner" aria-expanded={open} aria-controls={`course-${course.key}`}
            onClick={() => setCourseToggles((previous) => ({ ...previous, [course.key]: !open }))}>
            <Icon name="book" size={24} />
            <span className="catalog-text"><strong>{course.title}</strong><span>{course.summary || '설명을 읽고, 직접 풀며 한 단계씩 이해해요.'}</span></span>
            <span className="catalog-progress">
              <span>{state ? `${complete} / ${lessonsHere.length}개 완료` : `${lessonsHere.length}개 수업`}</span>
              {/* Drawn only where there is something to draw: a bar sitting empty under every course
                  of a catalogue nobody has started reads as 「you have done none of this」 thirty-eight
                  times over. The number above it already says so once, quietly. */}
              {state && (complete > 0 || started) && <i aria-hidden="true"><b style={{ width: `${Math.round((complete / lessonsHere.length) * 100)}%` }} /></i>}
            </span>
            <Icon name="chevron" size={18} />
          </button></h3>
          {open && <div className="class-grid" id={`course-${course.key}`}>{lessonsHere.map((item, index) => <div className="class-option" key={item.lessonKey}><LessonCard item={item} index={index} courseTitle={course.title} enrollment={state?.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />{state && <button className="text-button course-preference" disabled={busy} onClick={() => { void dispatch({ action: 'recommendation.choose', lessonKey: item.lessonKey }).then(() => navigate('home')).catch(() => {}); }}>{state.plan.preferredLessonKey === item.lessonKey ? '내가 고른 수업 ✓' : '이 수업부터 배우기'}</button>}</div>)}
            {/* The door to this course's problem sets, drawn as a card because it stands among cards —
                a line of text between them reads as a footnote rather than as a thing to open. */}
            {sets.length > 0 && <div className="class-option"><button className="class-card set-card" disabled={busy} onClick={() => openCourseSets(course.key)}>
              <LessonArt lessonKey={lessonsHere[0]?.lessonKey ?? course.key} />
              <div className="class-card-content"><div className="class-card-meta"><span>{course.title} · 문제집</span></div>
                <h3>문제집 {sets.length}개 풀기</h3><p>설명 없이 문제만 풀고 싶을 때. 수업에서 쓰는 문제집을 그대로 골라 풀 수 있어요.</p>
                <div className="class-card-footer"><span><Icon name="pencil" size={14} />문제 {sets.reduce((sum, set) => sum + set.questionCount, 0)}개</span><Icon name="arrow" size={18} /></div>
              </div>
            </button></div>}</div>}
        </section>;
      })])}</div>)}
      {query && !shown.length && <EmptyState title="찾는 이름이 없어요" text="코스 이름이나 수업 이름의 일부만 적어도 괜찮아요. 「전체」에서 목록을 훑어봐도 좋아요." actionLabel="찾기 지우기" onAction={() => setLessonSearch('')} />}
      {!lessons.length && <EmptyState title="수업을 준비하고 있어요" text="잠시 후 다시 확인해 주세요." />}</>;
  }

  /** The shelf a learner picks from: every course's problem sets, one course opened at a time. */
  function renderShelf() {
    const shelves = courses.map((course) => ({ course, sets: problemSets.filter((set) => set.courseKey === course.key) })).filter((shelf) => shelf.sets.length);
    if (!shelves.length) return <p className="empty-inline">고를 수 있는 문제집이 아직 없어요.</p>;
    const started = new Map((state?.assignments ?? []).filter((item) => item.policy.kind === 'practice')
      .map((item) => [item.problemSetId, item] as const));
    // The shelf is grouped the way the lesson list is, so a set from another line of study is not
    // met as though it were the next thing in this one.
    const lines = courseTracks.filter((track) => shelves.some((shelf) => shelf.course.track === track));
    return <div className="problem-shelf">{lines.map((track) => <div className="shelf-track" key={track}>
      {lines.length > 1 && <p className="shelf-track-name">{courseTrackLabels[track]}</p>}
      {shelves.filter((shelf) => shelf.course.track === track).map(({ course, sets }) => {
      const open = openShelves.includes(course.key);
      const questions = sets.reduce((sum, set) => sum + set.questionCount, 0);
      return <section key={course.key} id={shelfGroupId(course.key, null)} className={open ? 'shelf-course is-open' : 'shelf-course'}>
        <button className="shelf-course-head" aria-expanded={open}
          onClick={() => setOpenShelves((previous) => open ? previous.filter((key) => key !== course.key) : [...previous, course.key])}>
          <span className="shelf-course-title"><strong>{course.title}</strong><small>문제집 {sets.length}개 · 문제 {questions}개</small></span>
          <Icon name="chevron" size={18} />
        </button>
        {open && <ul className="shelf-set-list">{sets.map((set, index) => {
          const run = started.get(set.problemSetId);
          const labels = set.conceptKeys.map((key) => taughtConcepts.find((concept) => concept.key === key)?.label).filter(Boolean);
          // The sets arrive in lesson order, so a heading is drawn wherever the lesson changes. The
          // ones no lesson shows come last and are named for what they are rather than by a lesson.
          const heading = set.lessonKey === sets[index - 1]?.lessonKey ? null
            : set.lessonKey ? lessons.find((lesson) => lesson.lessonKey === set.lessonKey)?.title
            : '수업과 따로, 모아 풀기';
          // A lesson's sets stand together, and the group carries the lesson's name as its id so a
          // learner arriving from that lesson lands on them rather than at the top of the course.
          return <li key={set.problemSetId} id={heading ? shelfGroupId(course.key, set.lessonKey) : undefined}>
            {heading && <p className="shelf-lesson">{heading}</p>}
            <button className="shelf-set" disabled={busy} onClick={() => void startProblemSet(set.problemSetId)}>
              <LessonArt lessonKey={setArtKey(set.problemSetId, set.lessonKey)} small />
              <span className="shelf-set-info"><strong>{set.name}</strong><small>{set.questionCount}문제{labels.length ? ` · ${labels.join(' · ')}` : ''}</small></span>
              <span className="shelf-set-action">{run?.status === 'submitted' ? '다시 풀기' : run ? '이어서 풀기' : '풀어보기'}<Icon name="arrow" size={16} /></span>
            </button>
          </li>;
        })}</ul>}
      </section>;
    })}</div>)}</div>;
  }

  function renderPractice() {
    const submitted = state?.assignments.filter((item) => item.status === 'submitted') ?? [];
    // Work somebody issued and work the learner picked are listed apart, so neither screen has to
    // call the other's thing by its name.
    const issued = pendingAssignments.filter((item) => item.policy.kind !== 'practice');
    const chosen = pendingAssignments.filter((item) => item.policy.kind === 'practice');
    const done = submitted.filter((item) => item.policy.kind !== 'practice');
    const solved = submitted.filter((item) => item.policy.kind === 'practice');
    return <><div className="page-heading"><h1>이해를 오래 남기는 연습장.</h1><p>어제 배운 내용을 오늘 다시 떠올려보세요. 문제집을 직접 골라 풀 수도 있어요.</p></div><div className="section-heading"><h2>나에게 배정된 과제 <span className="count-label">{issued.length}</span></h2></div>{issued.length ? <div className="assignment-list">{issued.map(assignmentRow)}</div> : <EmptyState title={state ? '남아 있는 과제가 없어요' : '나의 연습을 시작해 볼까요?'} text={state ? '복습이 있는 수업을 마치면 과제가 배정돼요. 아래에서 문제집을 직접 골라 풀어도 좋아요.' : '학습 공간을 시작하면 수업과 연결된 과제를 풀고 기록할 수 있어요.'} actionLabel={state ? '문제집 고르기' : '내 학습 시작하기'} onAction={() => state ? openCourseSets(courses[0]?.key ?? '') : setModal('login')} />}{chosen.length > 0 && <section className="dashboard-section"><div className="section-heading"><h2>풀던 문제집 <span className="count-label">{chosen.length}</span></h2></div><div className="assignment-list">{chosen.map(assignmentRow)}</div></section>}<section className="dashboard-section"><div className="section-heading"><div><h2>문제집 골라 풀기</h2></div></div><p className="muted small">설명 없이 문제만 풀고 싶을 때. 수업에서 쓰는 문제집을 그대로 골라 풀 수 있고, 푼 기록은 수업에서 푼 것과 똑같이 남아요.</p>{renderShelf()}</section>{done.length > 0 && <section className="dashboard-section"><div className="section-heading"><h2>제출한 과제 <span className="count-label">{done.length}</span></h2></div><div className="assignment-list">{done.map(assignmentRow)}</div></section>}{solved.length > 0 && <section className="dashboard-section"><div className="section-heading"><h2>다 푼 문제집 <span className="count-label">{solved.length}</span></h2></div><div className="assignment-list">{solved.map(assignmentRow)}</div></section>}</>;
  }

  function renderHistory() {
    return <><div className="page-heading"><h1>조금씩 쌓이는 나의 이해.</h1><p>빠르기보다, 어제보다 조금 더 이해하는 것. 여기까지 온 걸음을 확인해요.</p></div>{!state ? <EmptyState title="첫 걸음을 기록해 보세요" text="내 학습을 시작하면 수업 진도와 개념별 학습 기록이 여기에 모여요." actionLabel="내 학습 시작하기" onAction={() => setModal('login')} /> : <><div className="history-stats"><div><small>완료한 수업</small><strong>{completedCount}<span>개</span></strong></div><div><small>제출한 과제</small><strong>{state.assignments.filter((item) => item.status === 'submitted' && item.policy.kind !== 'practice').length}<span>개</span></strong></div><div><small>다 푼 문제집</small><strong>{state.assignments.filter((item) => item.status === 'submitted' && item.policy.kind === 'practice').length}<span>개</span></strong></div><div><small>풀어본 문제</small><strong>{state.enrollments.reduce((sum, item) => sum + new Set(item.attempts.map((attempt) => attempt.problemVersionId)).size, 0) + state.assignments.reduce((sum, item) => sum + item.items.filter((entry) => entry.attempt).length, 0)}<span>개</span></strong></div></div><section className="dashboard-section"><div className="section-heading"><h2>코스별 학습 상태</h2><span className="muted small">힌트 사용과 이후 복습까지 반영한 상태예요</span></div><p className="muted small">「스스로 해결」은 힌트 없이 푼 기록, 「꾸준히 기억」은 이후 복습에서도 확인한 기록이에요. 아직 확인 전이라고 해서 모른다는 뜻은 아니에요. 코스를 열면 그 코스가 가르치는 개념이 하나씩 보여요.</p><StandingByCourse courses={courses} lessons={lessons} concepts={state.concepts} busy={busy} /></section>{state.misconceptions.length > 0 && <section className="dashboard-section"><div className="section-heading"><div><h2>자꾸 되풀이되는 것</h2></div><span className="muted small">서로 다른 문항에서 두 번 이상 나온 것만 모아요</span></div>
      <p className="muted small">답한 것에서 읽은 거예요. 한 번은 손이 미끄러진 것일 수 있어서, 두 문항에서 같은 것이 나왔을 때만 여기에 둡니다.</p>
      <div className="standing-slips">{state.misconceptions.map((slip) => <article key={slip.key}>
        <div><strong>{slip.label}<span>{slip.problems}문항</span></strong><p>{slip.note}</p></div>
        <button className="button secondary" disabled={busy} onClick={() => void gatherPractice(slip.key)}>이것만 모아 풀기<Icon name="arrow" size={16} /></button>
      </article>)}</div>
      <p className="muted small">이 착각을 잡으려고 만든 문항만 골라 문제집 하나로 모아 드려요. 이미 힌트 없이 맞힌 문항은 빼요.</p>
    </section>}<section className="dashboard-section"><div className="section-heading"><h2>추천이 바뀐 기록</h2></div><p className="muted small">학습과 설정을 저장할 때 달라진 추천을 최근 10개까지 보여줘요.</p><div className="recommendation-history">{state.recommendationHistory.map(entry => <article key={entry.id}><small>{formatDate(entry.createdAt)}</small>{entry.recommendations.map(item => <div key={item.lessonKey}><strong>{lessons.find(c => c.lessonKey === item.lessonKey)?.title ?? '이전 수업'}</strong><p>{item.reason}</p><small>하루 계획 {item.suggestedMinutes}분</small></div>)}</article>)}</div>{!state.recommendationHistory.length && <p className="empty-inline">아직 추천이 바뀐 기록이 없어요.</p>}</section>{(['active', 'completed'] as const).map((status) => <section key={status} className="dashboard-section"><div className="section-heading"><h2>{status === 'active' ? '이어서 배울 수업' : '완료한 수업'}</h2></div><div className="class-grid">{lessons.filter((item) => state.enrollments.some((enrollment) => enrollment.lessonKey === item.lessonKey && enrollment.status === status)).map((item) => <LessonCard key={item.lessonKey} item={item} index={courseIndex(item)} courseTitle={courseTitle(item)} enrollment={state.enrollments.find((entry) => entry.lessonKey === item.lessonKey)} onOpen={() => void openLesson(item.lessonKey)} />)}</div>{!state.enrollments.some((item) => item.status === status) && <p className="empty-inline">{status === 'active' ? '현재 이어서 배울 수업이 없어요.' : '완료한 수업이 여기에 모여요.'}</p>}</section>)}</>}</>;
  }

  function renderLesson() {
    if (lessonLoading) return <div className="loading-panel" role="status"><span className="loader" />수업을 펼치고 있어요…</div>;
    if (!document) return <EmptyState title="수업을 열 수 없어요" text="수업 목록으로 돌아가 다시 열어 주세요." actionLabel="수업 목록" onAction={() => navigate('lessons')} />;
    const review = state?.assignments.find((item) => item.lessonKey === document.lessonKey && item.policy.kind === 'review' && item.status === 'assigned');
    // The sets this lesson's steps show. A learner who wants only the questions should not have to
    // walk the lesson again to reach them, so the lesson itself says where they are.
    const lessonSets = problemSets.filter((set) => set.lessonKey === document.lessonKey);
    /**
     * What this lesson's questions showed, read from the answers already saved against it. The
     * first answer to each question is what counts, because that is what the learner could do
     * before the question told them anything.
     */
    const lessonReport: ReportItem[] = document.problems.map((problem) => {
      const tries = (currentEnrollment?.attempts ?? []).filter((item) => item.problemVersionId === problem.problemVersionId
        && item.result.status !== 'invalid');
      return { conceptKeys: problem.conceptKeys, correct: tries.at(-1)?.result.status === 'correct',
        firstCorrect: tries[0]?.result.status === 'correct', assisted: !!tries[0]?.result.assisted,
        misreading: tries[0]?.result.misreading, misconception: tries[0]?.result.misconception };
    }).filter((item, index) => (currentEnrollment?.attempts ?? []).some((attempt) => attempt.problemVersionId === document.problems[index].problemVersionId));
    if (finishedLesson) return <div className="completion-panel"><span className="completion-mark"><Icon name="check" size={38} /></span><h1>오늘의 이해가 하나 더 쌓였어요.</h1><p>「{document.title}」 수업을 완료했어요.<br />{review ? '배운 내용을 다시 떠올릴 복습 과제가 있어요.' : '다음 수업을 살펴보거나, 오늘 배운 내용을 다시 펼쳐보세요.'}</p><div className="completion-actions"><button className="button primary" onClick={() => review ? openAssignment(review) : navigate('lessons')}>{review ? '복습 과제 확인' : '다음 수업 둘러보기'}<Icon name="arrow" size={18} /></button><button className="button secondary" onClick={() => navigate('home')}>내 학습으로</button></div>{lessonSets.length > 0 && <button className="text-button completion-sets" disabled={busy} onClick={() => openCourseSets(document.courseKey, document.lessonKey)}>이 수업의 문제집 {lessonSets.length}개 다시 풀기<Icon name="arrow" size={15} /></button>}<AnswerReport items={lessonReport} concepts={taughtConcepts} lessons={lessons} standings={state?.concepts} busy={busy} onOpenLesson={(key) => void openLesson(key)} /><div className="completion-bottom">잘 모르겠는 부분은 언제든 다시 펼쳐보세요.</div></div>;
    const section = document.sections[sectionIndex];
    if (!section) return <EmptyState title="수업 내용을 준비하고 있어요" text="아직 공개된 학습 단계가 없어요." />;
    const unsupported = unsupportedRequiredBlocks(section.contentBlocks, document.problems) || document.problems.some((problem) => unsupportedRequiredBlocks(problem.promptContent));
    const isLast = sectionIndex === document.sections.length - 1;
    // Answering belongs to the enrolment. Without one the card offers to start rather than to answer.
    const enrolled = currentEnrollment?.id ?? '';
    const lessonActions = (problemVersionId: string): ProblemActions => ({
      submit: (answer, requestId) => dispatch({ action: 'attempt.submit', context: 'lesson', contextId: enrolled, problemVersionId, answer, requestId }).then(() => undefined),
      openHint: () => dispatch({ action: 'hint.open', context: 'lesson', contextId: enrolled, problemVersionId }).then((response) => response.hint ?? []),
      openSolution: () => dispatch({ action: 'solution.open', context: 'lesson', contextId: enrolled, problemVersionId }).then((response) => response.solution ?? []),
    });
    // Questions receive leaf definitions; only instructional prose gets the shared explorer.
    const glossary: GlossaryContext = { entries: document.glossary, reviewConceptKeys, currentLessonKey: document.lessonKey, onOpenLesson: (key) => void openLesson(key) };
    // A question a learner cannot answer says why, because a grey box on its own reads as a fault
    // in the screen. Only one of the three reasons can be acted on, and that one carries the way back.
    const waitingStep = currentEnrollment ? document.sections.slice(0, sectionIndex).findIndex((item) => !currentEnrollment.completedSectionIds.includes(item.sectionId)) : -1;
    const stepDone = !!currentEnrollment?.completedSectionIds.includes(section.sectionId);
    const lessonDone = currentEnrollment?.status === 'completed';
    const answeringClosed = lessonDone || stepDone || waitingStep >= 0;
    const closedNote = lessonDone ? '학습을 마친 수업이에요. 저장한 풀이는 그대로 볼 수 있어요.'
      : stepDone ? '이 단계는 이미 끝냈어요. 저장한 풀이는 그대로 남아 있어요.'
      : waitingStep >= 0 ? <>앞 단계를 끝내면 이 문제를 풀 수 있어요. <button className="text-button" disabled={busy} onClick={() => setSectionIndex(waitingStep)}><Icon name="back" size={14} />{waitingStep + 1}단계로 돌아가기</button></>
      : undefined;
    return <ConceptExplorer key={`${state?.user.id ?? 'public'}:${document.versionId}:${section.sectionId}`} glossary={glossary} lessons={lessons}
      loadDefinition={(path) => learningApi.definition({ lessonKey: document.lessonKey, lessonVersionId: document.versionId, path })}>{(readingGlossary) => <><button className="back-button" onClick={() => navigate('lessons')}><Icon name="back" size={17} />수업 목록</button><div className="lesson-header"><div><div className="eyebrow">{courseTitle(document)} · {document.estimatedMinutes}분 수업</div><h1>{document.title}</h1></div><span className={`pill ${currentEnrollment?.status === 'completed' ? 'green' : ''}`}>{currentEnrollment?.status === 'completed' ? '학습 완료' : currentEnrollment ? '학습 중' : '수업 미리보기'}</span></div>{!currentEnrollment && <div className="preview-banner"><div><strong>설명은 먼저 둘러볼 수 있어요.</strong><p>수업을 시작하면 문제를 풀고 진도를 저장할 수 있어요.</p></div><button className="button primary" disabled={busy} onClick={() => void startLesson()}>{state ? '이 수업 시작하기' : '내 학습 시작하기'}<Icon name="arrow" size={16} /></button></div>}{state && <div className="session-guidance"><strong>오늘은 {state.user.dailyMinutes}분씩, 나의 속도로.</strong><p>한 단계가 끝나면 쉬어도 괜찮아요. 다음 방문에 저장된 단계부터 이어가며 설명과 문제는 모두 남아 있어요.</p></div>}<div className="lesson-layout"><aside className="lesson-outline" aria-label="수업 학습 단계"><span className="eyebrow">수업 단계</span>{document.sections.map((item, index) => <button key={item.sectionId} className={index === sectionIndex ? 'active' : ''} aria-current={index === sectionIndex ? 'step' : undefined} disabled={busy} onClick={() => setSectionIndex(index)}><span className={currentEnrollment?.completedSectionIds.includes(item.sectionId) ? 'done' : ''}>{currentEnrollment?.completedSectionIds.includes(item.sectionId) ? <Icon name="check" size={13} /> : index + 1}</span><span><small>{roleLabels[item.role]}</small>{item.title}</span></button>)}<p>헷갈리면 앞 단계로 돌아가도 괜찮아요.</p>{lessonSets.length > 0 && <button className="text-button outline-sets" disabled={busy} onClick={() => openCourseSets(document.courseKey, document.lessonKey)}><Icon name="pencil" size={14} />이 수업의 문제집 {lessonSets.length}개</button>}</aside><div><article className="lesson-sheet"><div className="lesson-step-label">{String(sectionIndex + 1).padStart(2, '0')}<i />{roleLabels[section.role]}</div><h2>{section.title}</h2><ContentBlocks blocks={section.contentBlocks} problems={document.problems} glossary={canExploreDefinitions(section.role) ? readingGlossary : glossary} renderProblem={(problem) => <ProblemCard key={`${currentEnrollment?.id ?? 'preview'}-${problem.problemVersionId}`} glossary={glossary} problem={problem} attempt={currentEnrollment?.attempts.filter((item) => item.problemVersionId === problem.problemVersionId).at(-1)} actions={lessonActions(problem.problemVersionId)} ready={!!currentEnrollment} busy={busy} disabled={answeringClosed} disabledNote={closedNote} onReady={() => currentEnrollment ? setModal('login') : void startLesson()} readyNote="수업을 시작하면 풀이와 진도가 저장돼요." />} /></article>{unsupported && <div className="error-banner" role="alert">필수 콘텐츠를 표시할 수 없어 단계 완료를 멈췄어요. 지원되는 앱 버전에서 다시 열어 주세요.</div>}<div className="lesson-controls"><button className="button secondary" disabled={sectionIndex === 0 || busy} onClick={() => setSectionIndex((value) => value - 1)}><Icon name="back" size={17} />이전</button><span>{sectionIndex + 1} / {document.sections.length}</span>{!currentEnrollment && isLast ? <button className="button primary" disabled={busy || unsupported} onClick={() => void startLesson()}>수업 시작하기<Icon name="arrow" size={17} /></button> : <button className="button primary" disabled={busy || unsupported} onClick={() => void nextSection()}>{busy ? '저장 중…' : isLast ? currentEnrollment?.status === 'completed' ? '내 학습으로' : '수업 완료하기' : currentEnrollment?.status === 'active' ? '이해했어요, 다음으로' : '다음 단계'}<Icon name="arrow" size={17} /></button>}</div></div></div></>}</ConceptExplorer>;
  }

  function renderAssignment() {
    if (!assignment) return <EmptyState title="과제를 찾을 수 없어요" text="학습 공간에 로그인한 뒤 나에게 배정된 과제를 열어 주세요." actionLabel="연습장으로" onAction={() => navigate('practice')} />;
    const submitted = assignment.status === 'submitted';
    const answered = assignment.items.filter((item) => item.attempt && item.attempt.result.status !== 'invalid').length;
    const unsupported = assignment.items.some((item) => unsupportedRequiredBlocks(item.problem.promptContent));
    const recipient = assignment.recipientId ?? '';
    // Never answered, answered in a form the grading refused, or written and not sent: all three
    // are work the learner still has to come back to, and the screen counts them as one thing.
    const unfinished = (item: AssignmentView['items'][number]) =>
      !item.attempt || item.attempt.result.status === 'invalid' || dirtyProblems.includes(item.problem.problemVersionId);
    const remaining = assignment.items.findIndex(unfinished);
    /**
     * A right answer carries the learner on to the next question they have not answered; a wrong
     * one leaves them where they are, because reading why it was wrong is the point of that moment.
     * Nothing before the answered question moves, so going back to fix one is not a trip forward.
     */
    function carryOn(problemVersionId: string, saved: LearningState) {
      // Work that shows results only after it is handed in says nothing here either: moving the
      // learner on after a right answer would tell them the answer was right.

      const view = saved.assignments.find((entry) => entry.recipientId === recipient);
      const at = view?.items.findIndex((item) => item.problem.problemVersionId === problemVersionId) ?? -1;
      if (!view || at < 0 || view.items[at].attempt?.result.status !== 'correct') return;
      const next = view.items.findIndex((item, index) => index > at && (!item.attempt || item.attempt.result.status === 'invalid'));
      if (next >= 0) setProblemToShow(next);
    }
    const assignmentActions = (problemVersionId: string): ProblemActions => ({
      submit: (answer, requestId) => dispatch({ action: 'attempt.submit', context: 'assignment', contextId: recipient, problemVersionId, answer, requestId }).then((response) => carryOn(problemVersionId, response.state)),
      openHint: () => dispatch({ action: 'hint.open', context: 'assignment', contextId: recipient, problemVersionId }).then((response) => response.hint ?? []),
      openSolution: () => dispatch({ action: 'solution.open', context: 'assignment', contextId: recipient, problemVersionId }).then((response) => response.solution ?? []),
    });
    // A set the learner picked is their own work, so it is never called an assignment to their face.
    const own = assignment.policy.kind === 'practice';
    // What the finished set showed. Read from the answers that were sent anyway — the first one to
    // each question for what the learner could do, the last for where they ended up.
    const report: ReportItem[] = assignment.items.map((item) => ({
      conceptKeys: item.problem.conceptKeys,
      correct: item.attempt?.result.status === 'correct',
      firstCorrect: item.firstResult?.status === 'correct',
      assisted: !!item.firstResult?.assisted,
      misreading: item.firstResult?.misreading,
      misconception: item.firstResult?.misconception,
    }));
    // Where to go next when this was a set they chose: the one after it in the same course. A set
    // gathered across the catalogue came from no course, so it has no next and says nothing.
    const shelf = assignment.problemSetId
      ? problemSets.filter((set) => set.courseKey === problemSets.find((entry) => entry.problemSetId === assignment.problemSetId)?.courseKey) : [];
    const next = shelf.length ? shelf[shelf.findIndex((set) => set.problemSetId === assignment.problemSetId) + 1] ?? null : null;
    const gathered = own && !assignment.problemSetId;
    return <><button className="back-button" onClick={() => navigate('practice')}><Icon name="back" size={17} />연습장으로</button><div className="page-heading"><h1>{assignment.title}</h1><p>{assignmentTiming(assignment)} · {assignment.items.length}문제 · {assignmentKindLabel[assignment.policy.kind]}{assignment.policy.hints ? '' : ' · 힌트 없이'}</p></div><div className={`assignment-instruction ${submitted ? 'is-submitted' : ''}`}><Icon name={submitted ? 'check' : 'pencil'} size={23} /><div><strong>{submitted ? own ? '이 문제집을 다 풀었어요.' : '과제 제출을 완료했어요.' : own ? '문제마다 답안을 저장하고, 다 풀면 마무리해 주세요.' : '문제마다 답안을 저장하고, 마지막에 제출해 주세요.'}</strong><p>{submitted ? '저장한 답안과 풀이 결과를 아래에서 다시 확인할 수 있어요.' : assignment.policy.hints ? '막히면 힌트를 확인하고 다시 생각해 보세요. 저장한 답안은 마무리 전까지 바꿀 수 있어요.' : '이 과제는 힌트 없이 풀어요. 저장한 답안은 제출 전까지 바꿀 수 있어요.'}</p></div>{submitted && <span>{own ? '풀이 완료' : '제출 완료'}</span>}</div>{assignment.reason && <p className="session-guidance">{assignment.reason}</p>}{!submitted && assignment.items.length > 2 && <div className="solve-progress">{/* Two questions fit on a screen together; a set that does not needs to carry its count and its way out along with it. */}
      <span className="solve-count"><strong>{answered} / {assignment.items.length}</strong> 저장<span className="solve-meter" aria-hidden="true"><i style={{ width: `${Math.round(answered / assignment.items.length * 100)}%` }} /></span></span>
      {remaining >= 0
        ? <button className="text-button" onClick={() => setProblemToShow(remaining)}>남은 문제로<Icon name="arrow" size={15} /></button>
        : <button className="button primary" disabled={busy || unsupported} onClick={() => void submitAssignment()}>{busy ? (own ? '저장 중…' : '제출 중…') : own ? '다 풀었어요' : '과제 제출하기'}<Icon name="check" size={16} /></button>}
    </div>}{submitted && <AnswerReport items={report} concepts={taughtConcepts} lessons={lessons} standings={state?.concepts} busy={busy} onOpenLesson={(key) => void openLesson(key)} />}<div className="assignment-problems">{assignment.items.map((item, index) => <section key={item.id} id={`problem-${index + 1}`}><ProblemCard label={`문제 ${String(index + 1).padStart(2, '0')}`} problem={{ ...item.problem, hintAvailable: item.problem.hintAvailable && assignment.policy.hints }} attempt={item.attempt} actions={assignmentActions(item.problem.problemVersionId)} ready={!!assignment.recipientId} submitLabel="답안 저장" solutionReady={submitted} glossary={{ entries: assignment.glossary, reviewConceptKeys, onOpenLesson: (key) => void openLesson(key) }} busy={busy} disabled={submitted} onReady={() => setModal('login')} readyNote="수업을 시작하면 풀이와 진도가 저장돼요." onDraftChange={(id, dirty) => setDirtyProblems((previous) => dirty ? previous.includes(id) ? previous : [...previous, id] : previous.filter((item) => item !== id))} /></section>)}</div>{!submitted && <div className="assignment-submit"><div><strong>{own ? '이 문제집을 마무리해 볼까요?' : '연습을 마무리해 볼까요?'}</strong><p>{dirtyProblems.length ? `아직 저장하지 않은 답안이 ${dirtyProblems.length}개 있어요. 먼저 답안을 저장해 주세요.` : own ? '모든 문제의 답안을 저장하면 마무리할 수 있어요.' : '모든 문제의 답안을 저장하면 제출할 수 있어요.'}</p>{remaining >= 0 && <button className="text-button" onClick={() => setProblemToShow(remaining)}>남은 문제로<Icon name="arrow" size={15} /></button>}</div><button className="button primary" disabled={busy || unsupported || dirtyProblems.length > 0 || answered !== assignment.items.length || !assignment.items.length} onClick={() => void submitAssignment()}>{busy ? (own ? '저장 중…' : '제출 중…') : own ? '다 풀었어요' : '과제 제출하기'}<Icon name="check" size={18} /></button></div>}{submitted && own && <div className="assignment-submit"><div><strong>{next ? '한 문제집 더 풀어 볼까요?' : gathered ? '이만큼 해 뒀어요.' : '이 과정의 문제집을 모두 풀었어요.'}</strong><p>{next ? `다음은 「${next.name}」이에요. ${next.questionCount}문제예요.` : gathered ? '같은 것이 또 나오면 학습 기록에 다시 모아 둘게요. 오늘은 여기까지도 좋아요.' : '다른 과정의 문제집을 골라 이어가도 좋아요.'}</p></div><button className="button primary" disabled={busy} onClick={() => next ? void startProblemSet(next.problemSetId) : navigate(gathered ? 'history' : 'practice')}>{next ? '이어서 풀기' : gathered ? '학습 기록 보기' : '문제집 고르기'}<Icon name="arrow" size={18} /></button></div>}</>;
  }

  return <div className="app-shell"><a href="#main-content" className="skip-link">본문으로 이동</a><aside className="sidebar"><button className="brand-button" aria-label="그냥수학 홈" onClick={() => navigate('home')}><Brand /></button><div className="sidebar-caption">그냥, 나의 속도로.</div><nav aria-label="주 메뉴">{navItems.map((item) => <button key={item.page} className={activeNav === item.page ? 'nav-item active' : 'nav-item'} aria-current={activeNav === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.page === 'practice' && pendingAssignments.length > 0 && <span className="nav-badge">{pendingAssignments.length}</span>}</button>)}</nav><div className="sidebar-bottom"><button className="learning-goal" onClick={openProfile}><span className="goal-overline"><Icon name="spark" size={14} />배우려는 과정</span><strong>{courses.find((course) => course.key === state?.user.targetCourseKey)?.title ?? '아직 고르지 않음'}</strong><span>하루 {state?.user.dailyMinutes ?? 10}분, 꾸준히<Icon name="chevron" size={14} /></span><div className="goal-line"><i /><i /><i /><i /><i /><i /><i /></div></button><div className="sidebar-signature">수학을 이해하는 즐거움<span>그냥수학 © 2026</span></div></div></aside><div className="workspace"><header className="topbar"><div className="mobile-brand"><button className="brand-button" onClick={() => navigate('home')} aria-label="홈으로"><Brand /></button></div><div className="breadcrumb"><span>나의 학습 공간</span><Icon name="chevron" size={13} /><strong>{navItems.find((item) => item.page === activeNav)?.label}</strong></div><div className="account-controls">{session?.developmentLogin && <span className="dev-label">개발 미리보기</span>}{state ? <><button className="account-button" onClick={openProfile}><span className="avatar">{state.user.displayName.slice(0, 1)}</span><span>{state.user.displayName}</span></button><button className="icon-button logout" onClick={() => void logout()} disabled={busy || loading} aria-label="로그아웃" title="로그아웃"><Icon name="logout" size={17} /></button></> : <button className="login-link" onClick={() => setModal('login')} disabled={loading}>내 학습 시작<Icon name="arrow" size={15} /></button>}</div></header><nav className="mobile-nav" aria-label="모바일 주 메뉴">{navItems.map((item) => <button key={item.page} className={activeNav === item.page ? 'active' : ''} aria-current={activeNav === item.page ? 'page' : undefined} onClick={() => navigate(item.page)}><Icon name={item.icon} size={18} />{item.label}</button>)}</nav><main id="main-content" className={`main-content page-${page}`} tabIndex={-1}>{authError && <div className="auth-error-banner" role="alert"><Icon name="lightbulb" size={18} /><span>{authError}</span><button className="text-button" disabled={loading || busy} onClick={() => setModal('login')}>로그인 다시 하기</button><button className="icon-button" aria-label="로그인 안내 닫기" onClick={() => setAuthError('')}><Icon name="close" size={16} /></button></div>}{error && <div className="error-banner" role="alert"><span>{error}</span><button className="text-button" disabled={busy || loading} onClick={() => void refresh()}>다시 불러오기</button><button className="icon-button" aria-label="오류 알림 닫기" onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}{notice && <div className="notice-banner" role="status"><Icon name="check" size={18} /><span>{notice}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice('')}><Icon name="close" size={16} /></button></div>}{loading ? <div className="loading-panel" role="status"><span className="loader" />나의 학습 공간을 준비하고 있어요…</div> : page === 'home' ? renderHome() : page === 'lessons' ? renderLessons() : page === 'practice' ? renderPractice() : page === 'history' ? renderHistory() : page === 'lesson' ? renderLesson() : page === 'diagnostic' ? state ? <DiagnosticPanel key={`${state.user.id}:${state.diagnostic?.currentProblem?.problemVersionId ?? state.diagnostic?.status ?? 'new'}`} diagnostic={state.diagnostic} offering={state.diagnosticOffering} nextLesson={recommended} readiness={state.plan.readiness} onOpenLesson={(key) => void openLesson(key)} dispatch={dispatch} busy={busy} onBack={() => navigate('home')} targetTitle={courses.find((course) => course.key === state.user.targetCourseKey)?.title ?? null} onChooseTarget={openProfile} /> : null : renderAssignment()}</main><ServiceFooter /></div>{modal && <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef}><button className="icon-button modal-close" aria-label="닫기" disabled={busy} onClick={() => setModal(null)}><Icon name="close" /></button>{modal === 'welcome' && state ? <FirstStep courses={courses} displayName={state.user.displayName} busy={busy} error={error} onSave={(choice) => void saveFirstStep(choice)} onLater={() => setModal(null)} /> : modal === 'login' ? <>
        <span className="modal-symbol"><Icon name="book" size={27} /></span>
        
        <h2 id="modal-title">나의 속도로 시작해 볼까요?</h2>
        <p>{!webAuthentication
          ? '앱에서의 계정 연결은 준비 중이에요. 지금은 웹브라우저에서 Google 로그인으로 학습을 이어갈 수 있어요.'
          : session?.googleLogin
            ? 'Google 계정으로 시작하면 나만의 학습 공간이 생겨요. 언제 다시 와도 진도와 풀이 기록을 이어갈 수 있어요.'
            : session?.developmentLogin
              ? '개발용 학습 공간에서 수업, 풀이, 과제 흐름을 체험할 수 있어요.'
              : 'Google 로그인을 준비하고 있어요. 그동안 수업 설명을 먼저 둘러보세요.'}</p>
        {authError && <p role="alert" className="field-error">{authError}</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
        {webAuthentication && session?.googleLogin && <>
          <GoogleLoginButton pending={googleStarting} disabled={busy || loading} onClick={beginGoogleLogin} />
          <p className="google-login-note">같은 Google 계정으로 다시 로그인하면 학습을 이어갈 수 있어요.</p>
        </>}
        {webAuthentication && session?.developmentLogin && <form onSubmit={login}>
          {session.googleLogin && <div className="login-divider"><span>개발 환경에서만</span></div>}
          <label className="form-label">어떻게 불러드릴까요?<input type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="학습자" maxLength={30} disabled={busy || googleStarting} autoComplete="nickname" /></label>
          <div className="dev-login-note"><strong>개발용 로그인</strong><span>Google 계정과 별개의 개발용 계정이에요. 이 브라우저의 임시 세션으로 저장되며, 로그아웃하면 새 학습 공간이 만들어질 수 있어요.</span></div>
          <button className="button secondary full-width" type="submit" disabled={busy || googleStarting}>{busy ? '학습 공간 준비 중…' : '개발용 학습 시작하기'}<Icon name="arrow" size={17} /></button>
        </form>}
        <p className="login-privacy-note">계정과 학습 기록을 사용하는 방법은 <Link href="/privacy/" target="_blank" rel="noopener noreferrer">개인정보 안내<span className="sr-only"> (새 창)</span></Link>에서 확인할 수 있어요.</p>
        <button className="text-button login-browse" disabled={busy || googleStarting} onClick={() => { setModal(null); navigate('lessons'); }}>수업 먼저 둘러보기<Icon name="arrow" size={16} /></button>
      </> : <><span className="modal-symbol"><Icon name="spark" size={27} /></span><h2 id="modal-title">무엇을 배우러 오셨나요?</h2><p>배우려는 과정을 고르면 시작점 확인이 거기까지 가는 데 필요한 것만 묻고, 추천도 그쪽을 향해요. 나중에 언제든 바꿀 수 있어요.</p><form onSubmit={saveProfile}><label className="form-label">배우려는 과정<select value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy}><option value="">아직 고르지 않을래요</option>{courseTracks.filter((track) => courses.some((course) => course.track === track)).flatMap((track) => byStage(courses, track).map((year) => <optgroup key={`${track}:${year.stage ?? ''}`} label={year.stage ? `${courseTrackLabels[track]} · ${courseStageLabels[year.stage]}` : courseTrackLabels[track]}>{year.courses.map((course) => <option key={course.key} value={course.key}>{course.title}</option>)}</optgroup>))}</select></label><label className="form-label">하루에 얼마나 함께할까요?<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} disabled={busy}>{[5, 10, 20].map((value) => <option key={value} value={value}>{value}분</option>)}</select></label>{error && <p role="alert" className="field-error">{error}</p>}<button className="button primary full-width" type="submit" disabled={busy}>{busy ? '저장 중…' : '이렇게 시작할게요'}<Icon name="check" size={17} /></button></form><button className="text-button profile-logout" disabled={busy || loading} onClick={() => void logout()}><Icon name="logout" size={16} />이 기기에서 로그아웃</button>{erasing ? <div className="account-erase asking" role="group" aria-label="계정 삭제 확인"><strong>계정과 학습 기록을 모두 지울까요?</strong><p>수업 진도와 풀이, 힌트 기록, 복습 과제와 제출, 시작점 확인, 추천 이력, 배우려는 과정 설정이 함께 사라져요. <b>되돌릴 수 없고 복구해 드릴 방법도 없어요.</b></p><p className="muted small">같은 Google 계정으로 다시 로그인하면 아무 기록도 없는 새 학습 공간으로 시작해요.</p><div className="account-erase-actions"><button className="button danger" disabled={busy} onClick={() => void eraseAccount()}>{busy ? '지우는 중…' : '네, 지울게요'}</button><button className="text-button" disabled={busy} onClick={() => setErasing(false)}>그만두기</button></div></div> : <button className="text-button account-erase-open" disabled={busy || loading} onClick={() => { setError(''); setErasing(true); }}><Icon name="close" size={15} />계정과 학습 기록 지우기</button>}</>}</div></div>}</div>;
}

function EmptyState({ title, text, actionLabel, onAction }: { title: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return <div className="empty-state"><span className="empty-drawing"><Icon name="book" size={29} /></span><h2>{title}</h2><p>{text}</p>{actionLabel && <button className="button secondary" onClick={onAction}>{actionLabel}<Icon name="arrow" size={17} /></button>}</div>;
}
