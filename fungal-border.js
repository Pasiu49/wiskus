/* Weighted fungi and flexible roots react to section scrolling, then settle. */
(() => {
    'use strict';

    const border = document.querySelector('.fungal-border');
    const scroller = document.querySelector('main');
    if (!border || !scroller) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const MAX_SCROLL_SPEED = 2500;
    const MAX_ANGLE = 24;
    const MAX_INWARD_ANGLE = 6;
    const MAX_OFFSET = 24;
    const GRAVITY_SAG = 9;
    const properties = ['--fungal-angle', '--fungal-y', '--fungal-stretch-x', '--fungal-stretch-y'];
    const spring = () => ({ position: 0, velocity: 0 });
    const bodies = [...border.querySelectorAll('.fungal-border-cluster')].map((element, index) => ({
        element, mass: 1 + (index % 4) * .27,
        angle: spring(), offset: spring(), stretch: spring()
    }));
    const number = /-?(?:\d*\.)?\d+/g;
    // These decorative paths contain absolute M/C/S/L coordinate pairs.
    const roots = [...border.querySelectorAll('.fungal-border-veins > path')].map(element => {
        const source = element.getAttribute('d');
        return { element, source, coordinates: [...source.matchAll(number)].map(match => Number(match[0])) };
    });
    if (!bodies.length) return;

    let frame = 0;
    let lastTime = 0;
    let lastScroll = scroller.scrollTop;
    let scrollSpeed = 0;
    let height = Math.max(1, border.clientHeight);

    function advance(state, target, stiffness, damping, mass, delta, limit, upperLimit = limit) {
        // Two small steps keep fast scroll impulses stable at lower frame rates.
        for (let step = 0; step < 2; step++) {
            state.velocity += ((target - state.position) * stiffness / mass
                - state.velocity * damping / Math.sqrt(mass)) * delta / 2;
            const next = state.position + state.velocity * delta / 2;
            state.position = clamp(next, -limit, upperLimit);
            if (next !== state.position) state.velocity *= -.2;
        }
    }

    function deformRoots(angle, offset, stretch) {
        for (const root of roots) {
            let index = 0;
            root.element.setAttribute('d', root.source.replace(number, () => {
                const axis = index % 2;
                const pair = index - axis;
                const x = root.coordinates[pair];
                const y = root.coordinates[pair + 1];
                // Keep the top, bottom and menu seam anchored as roots flex on either side.
                const free = Math.sin(Math.PI * clamp(y / 1000, 0, 1)) * clamp(Math.abs(80 - x) / 34, 0, 1);
                const value = axis ? y + offset * 1000 / height * free
                    : x + (angle * .22 + Math.sin(y / 140) * stretch * 30) * free;
                index++;
                return value.toFixed(2);
            }));
        }
    }

    function reset() {
        cancelAnimationFrame(frame);
        frame = 0;
        lastTime = 0;
        lastScroll = scroller.scrollTop;
        scrollSpeed = 0;
        border.classList.remove('is-moving');
        for (const body of bodies) {
            for (const state of [body.angle, body.offset, body.stretch]) {
                state.position = 0;
                state.velocity = 0;
            }
            for (const property of properties) body.element.style.removeProperty(property);
        }
        for (const root of roots) root.element.setAttribute('d', root.source);
    }

    function moving(state, threshold) {
        return Math.abs(state.position) > threshold || Math.abs(state.velocity) > threshold * 3;
    }

    function tick(now) {
        frame = 0;
        if (motion.matches || document.hidden) { reset(); return; }

        const delta = clamp((now - lastTime) / 1000, 1 / 120, 1 / 30);
        lastTime = now;
        const currentScroll = scroller.scrollTop;
        const measuredSpeed = clamp((currentScroll - lastScroll) / delta, -MAX_SCROLL_SPEED, MAX_SCROLL_SPEED);
        lastScroll = currentScroll;
        const previousSpeed = scrollSpeed;
        scrollSpeed += (measuredSpeed - scrollSpeed) * (1 - Math.exp(-delta * 16));
        const pull = scrollSpeed / MAX_SCROLL_SPEED;
        const jerk = clamp((scrollSpeed - previousSpeed) / delta / 12000, -1, 1);
        let active = Math.abs(scrollSpeed) > .5;

        for (const body of bodies) {
            const force = pull * 18 + jerk * 5;
            // Limit the swing toward the seam on both sides of the border.
            const angleTarget = force > 0 ? force * .32 : force;
            advance(body.angle, angleTarget, 75, 8.5, body.mass, delta, MAX_ANGLE, MAX_INWARD_ANGLE);
            // A tilted cap sags under its weight before the stem draws it back.
            const sag = Math.abs(body.angle.position) / MAX_ANGLE * GRAVITY_SAG;
            advance(body.offset, -pull * 17 + sag, 85, 9, body.mass, delta, MAX_OFFSET);
            const strain = Math.abs(pull) * .11 + Math.abs(jerk) * .035;
            advance(body.stretch, strain, 105, 10, body.mass, delta, .18);

            const length = 1 + body.stretch.position;
            body.element.style.setProperty('--fungal-angle', `${body.angle.position.toFixed(3)}deg`);
            body.element.style.setProperty('--fungal-y', `${body.offset.position.toFixed(3)}px`);
            body.element.style.setProperty('--fungal-stretch-x', (1 / Math.sqrt(length)).toFixed(4));
            body.element.style.setProperty('--fungal-stretch-y', length.toFixed(4));
            active ||= moving(body.angle, .015) || moving(body.offset, .015) || moving(body.stretch, .00015);
        }
        const average = key => bodies.reduce((sum, body) => sum + body[key].position, 0) / bodies.length;
        deformRoots(average('angle'), average('offset'), average('stretch'));
        if (active) frame = requestAnimationFrame(tick);
        else reset();
    }

    scroller.addEventListener('scroll', () => {
        if (motion.matches || document.hidden) { lastScroll = scroller.scrollTop; return; }
        if (frame) return;
        lastTime = performance.now();
        border.classList.add('is-moving');
        frame = requestAnimationFrame(tick);
    }, { passive: true });
    motion.addEventListener('change', reset);
    document.addEventListener('visibilitychange', reset);
    window.addEventListener('resize', () => {
        height = Math.max(1, border.clientHeight);
        reset();
    }, { passive: true });
})();
