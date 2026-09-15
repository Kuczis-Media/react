import { mountDashboard } from './dashboard/dashboard.jsx';
import { render, release, releaseWithin } from './shared/runtime.jsx';
import './assessment/exam.jsx';
import './assessment/quiz.jsx';
import './studio/canvases.jsx';
import './studio/builders.jsx';
import './studio/settings.jsx';
import './studio/tools.jsx';
import './studio/library.jsx';
import './studio/review.jsx';
import { renderLanding } from './landing/landing.jsx';

window.NextMedDashboardReact = Object.freeze({ mount: mountDashboard });
window.NextMedUI = Object.freeze({ render, release, releaseWithin, renderLanding });
