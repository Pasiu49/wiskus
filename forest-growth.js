/* Physarum-inspired transport network: food nodes, adaptive veins and protected content.
 * A Voronoi mesh gives three-way junctions; pressure/flux adaptation reinforces useful
 * tubes. This is a visual model, not a biological simulation of the organism.
 */
(() => {
    'use strict';
    if (!document.body.classList.contains('mycelium-page')) return;

    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const protectedSelector = '[data-mycelium-avoid], [data-physarum-node], .content-cloud, h1, h2, h3, p, a, button, img, iframe';
    // A numeric data-physarum-node marks an additional food source and its importance.
    const foodSelector = '[data-physarum-node], h1, .content-cloud';
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const random = (low, high) => low + Math.random() * (high - low);
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const GROW_TIME = 9000;
    const END_TIME = 18000;
    const POINTER_DWELL = 3000;
    const POINTER_TOLERANCE = 4;
    const NETWORK_CELLS = 280;
    const MIN_CELL_SPACING = 42;
    const colonies = [];
    let frame = 0;
    let lastTime = 0;
    let layoutFrame = 0;
    let pointerTimer = 0;
    let pointer = null;

    class Heap {
        constructor() { this.items = []; }
        push(value) {
            const a = this.items;
            let i = a.length;
            a.push(value);
            while (i > 0) {
                const p = (i - 1) >> 1;
                if (a[p].distance <= value.distance) break;
                a[i] = a[p];
                i = p;
            }
            a[i] = value;
        }
        pop() {
            const a = this.items;
            const first = a[0];
            const last = a.pop();
            if (a.length) {
                let i = 0;
                while (i * 2 + 1 < a.length) {
                    let child = i * 2 + 1;
                    if (child + 1 < a.length && a[child + 1].distance < a[child].distance) child++;
                    if (a[child].distance >= last.distance) break;
                    a[i] = a[child];
                    i = child;
                }
                a[i] = last;
            }
            return first;
        }
    }

    function intersects(a, b, rect) {
        let low = 0;
        let high = 1;
        for (const axis of ['x', 'y']) {
            const delta = b[axis] - a[axis];
            const min = axis === 'x' ? rect.left : rect.top;
            const max = axis === 'x' ? rect.right : rect.bottom;
            if (Math.abs(delta) < .00001) {
                if (a[axis] < min || a[axis] > max) return false;
            } else {
                const p = (min - a[axis]) / delta;
                const q = (max - a[axis]) / delta;
                low = Math.max(low, Math.min(p, q));
                high = Math.min(high, Math.max(p, q));
                if (low > high) return false;
            }
        }
        return true;
    }

    function triangle(a, b, c, sites) {
        const p = sites[a], q = sites[b], r = sites[c];
        const d = 2 * (p.x * (q.y - r.y) + q.x * (r.y - p.y) + r.x * (p.y - q.y));
        if (Math.abs(d) < .00001) return null;
        const pp = p.x * p.x + p.y * p.y;
        const qq = q.x * q.x + q.y * q.y;
        const rr = r.x * r.x + r.y * r.y;
        const x = (pp * (q.y - r.y) + qq * (r.y - p.y) + rr * (p.y - q.y)) / d;
        const y = (pp * (r.x - q.x) + qq * (p.x - r.x) + rr * (q.x - p.x)) / d;
        return { a, b, c, x, y, radius: (x - p.x) ** 2 + (y - p.y) ** 2 };
    }

    function triangulate(sites, size) {
        const count = sites.length;
        sites.push({ x: -size * 8, y: -size * 4 }, { x: size * 9, y: -size * 4 }, { x: 0, y: size * 10 });
        let triangles = [triangle(count, count + 1, count + 2, sites)];
        for (let i = 0; i < count; i++) {
            const point = sites[i];
            const boundary = new Map();
            const keep = [];
            for (const item of triangles) {
                if ((point.x - item.x) ** 2 + (point.y - item.y) ** 2 > item.radius + .0001) {
                    keep.push(item);
                    continue;
                }
                for (const [a, b] of [[item.a, item.b], [item.b, item.c], [item.c, item.a]]) {
                    const key = a < b ? `${a},${b}` : `${b},${a}`;
                    if (boundary.has(key)) boundary.delete(key);
                    else boundary.set(key, [a, b]);
                }
            }
            for (const [a, b] of boundary.values()) {
                const next = triangle(a, b, i, sites);
                if (next) keep.push(next);
            }
            triangles = keep;
        }
        sites.length = count;
        return triangles.filter(item => item.a < count && item.b < count && item.c < count);
    }

    function shortest(nodes, source) {
        const heap = new Heap();
        const distances = new Float64Array(nodes.length).fill(Infinity);
        const parents = new Array(nodes.length).fill(null);
        distances[source.id] = 0;
        heap.push({ node: source, distance: 0 });
        while (heap.items.length) {
            const entry = heap.pop();
            if (entry.distance !== distances[entry.node.id]) continue;
            for (const edge of entry.node.edges) {
                const other = edge.a === entry.node ? edge.b : edge.a;
                const next = entry.distance + edge.cost;
                if (next >= distances[other.id]) continue;
                distances[other.id] = next;
                parents[other.id] = edge;
                heap.push({ node: other, distance: next });
            }
        }
        return { distances, parents };
    }

    function components(nodes) {
        const visited = new Set();
        const groups = [];
        for (const first of nodes) {
            if (!first.edges.length || visited.has(first)) continue;
            const group = [first];
            visited.add(first);
            for (let i = 0; i < group.length; i++) {
                for (const edge of group[i].edges) {
                    const other = edge.a === group[i] ? edge.b : edge.a;
                    if (!visited.has(other)) { visited.add(other); group.push(other); }
                }
            }
            groups.push(group);
        }
        return groups;
    }

    class Colony {
        constructor(host) {
            this.host = host;
            this.canvas = document.createElement('canvas');
            this.canvas.className = 'mycelium-colony';
            this.canvas.setAttribute('aria-hidden', 'true');
            host.append(this.canvas);
            this.context = this.canvas.getContext('2d');
            this.cache = document.createElement('canvas');
            this.visible = false;
            this.ready = false;
            this.done = false;
            this.geometry = '';
            this.protected = [];
            new MutationObserver(queueLayout).observe(host, {
                childList: true, characterData: true, subtree: true,
                attributes: true, attributeFilter: ['data-mycelium-avoid', 'data-physarum-node']
            });
        }

        measure() {
            const host = this.host.getBoundingClientRect();
            this.width = this.host.clientWidth;
            this.height = this.host.clientHeight;
            const margin = innerWidth <= 768 ? 10 : 14;
            const elements = [...this.host.querySelectorAll(protectedSelector)];
            const hamburger = document.querySelector('.hamburger-menu');
            if (hamburger && getComputedStyle(hamburger).display !== 'none') elements.push(hamburger);
            const parents = new Set(elements);
            this.protected = [];
            this.foods = [];
            for (const element of elements) {
                let parent = element.parentElement;
                while (parent && parent !== this.host && !parents.has(parent)) parent = parent.parentElement;
                if (parent && parent !== this.host && parents.has(parent)) continue;
                if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') continue;
                const box = element.getBoundingClientRect();
                if (!box.width || !box.height) continue;
                const left = box.left - host.left - this.host.clientLeft + this.host.scrollLeft;
                const top = box.top - host.top - this.host.clientTop + this.host.scrollTop;
                if (left > this.width || left + box.width < 0 || top > this.height || top + box.height < 0) continue;
                const padded = { left: left - margin, right: left + box.width + margin,
                    top: top - margin, bottom: top + box.height + margin };
                this.protected.push(padded);
                if (element.matches(foodSelector)) {
                    const weight = Number(element.dataset.physarumNode) || (element.matches('h1') ? 3 : 2);
                    this.foods.push({ weight, rect: padded });
                }
            }
            const geometry = [this.width, this.height, ...this.protected.flatMap(rect =>
                [rect.left, rect.top, rect.right, rect.bottom].map(value => Math.round(value / 4))),
                ...this.foods.map(food => food.weight)].join(',');
            if (geometry !== this.geometry) { this.geometry = geometry; this.reset(); }
        }

        blocked(a, b = a) {
            return b.x < 2 || b.x > this.width - 2 || b.y < 2 || b.y > this.height - 2
                || this.protected.some(rect => intersects(a, b, rect));
        }

        node(point) {
            const node = { x: point.x, y: point.y, id: this.nodes.length, edges: [], food: 0, source: false, pressure: 0, birth: 0 };
            this.nodes.push(node);
            return node;
        }

        connect(a, b, boundary = false) {
            if (a === b || this.blocked(a, b) || a.edges.some(edge => edge.a === b || edge.b === b)) return;
            const length = distance(a, b);
            if (length < .1) return;
            let bend = random(-.38, .38) * Math.min(length, 100);
            let control = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * bend,
                y: (a.y + b.y) / 2 + (b.x - a.x) / length * bend };
            // A curved vein must obey the same exclusion zone as its straight chord.
            if (this.blocked(a, control) || this.blocked(control, b)) {
                bend = 0;
                control = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            }
            const edge = { a, b, control, length, cost: length * (boundary ? 1.8 : 1),
                conductance: .2, traffic: 0, flux: 0, level: 0, bend };
            a.edges.push(edge);
            b.edges.push(edge);
            this.edges.push(edge);
        }

        attach(point, candidates, boundary = false) {
            if (this.blocked(point)) return null;
            const closest = candidates.filter(node => distance(point, node) < this.spacing * 3.4 && !this.blocked(point, node))
                .sort((a, b) => distance(point, a) - distance(point, b)).slice(0, 3);
            if (!closest.length) return null;
            const node = this.node(point);
            for (const other of closest) this.connect(node, other, boundary);
            return node;
        }

        buildMesh() {
            this.nodes = [];
            this.edges = [];
            this.terminals = [];
            // Wider cells leave more open space, with a fixed budget on large screens.
            this.spacing = Math.max(MIN_CELL_SPACING, Math.sqrt(this.width * this.height / NETWORK_CELLS));
            const sites = [];
            const step = this.spacing;
            for (let y = -step; y < this.height + step * 2; y += step) {
                for (let x = -step; x < this.width + step * 2; x += step) {
                    sites.push({ x: x + random(-.43, .43) * step, y: y + random(-.43, .43) * step });
                }
            }
            const mesh = triangulate(sites, Math.max(this.width, this.height));
            const adjacent = new Map();
            for (const item of mesh) {
                const node = this.blocked(item) ? null : this.node(item);
                for (const [a, b] of [[item.a, item.b], [item.b, item.c], [item.c, item.a]]) {
                    const key = a < b ? `${a},${b}` : `${b},${a}`;
                    if (adjacent.has(key)) {
                        const other = adjacent.get(key);
                        if (node && other) this.connect(node, other);
                    } else adjacent.set(key, node);
                }
            }
            const interior = [...this.nodes];
            // Boundary vessels keep narrow passages traversable and meet between sections.
            const perimeter = [];
            for (let x = 4; x < this.width - 4; x += step) perimeter.push({ x, y: 4 });
            for (let y = 4; y < this.height - 4; y += step) perimeter.push({ x: this.width - 4, y });
            for (let x = this.width - 4; x > 4; x -= step) perimeter.push({ x, y: this.height - 4 });
            for (let y = this.height - 4; y > 4; y -= step) perimeter.push({ x: 4, y });
            let previous = null;
            let first = null;
            for (const point of perimeter) {
                if (this.blocked(point)) { previous = null; continue; }
                const node = this.attach(point, interior, true) || this.node(point);
                if (previous) this.connect(previous, node, true);
                if (!first) first = node;
                previous = node;
            }
            if (previous && first && distance(previous, first) < step * 1.5) this.connect(previous, first, true);
            // Start anywhere in the largest connected free area, rather than at an edge.
            const largest = components(this.nodes).sort((a, b) => b.length - a.length)[0] || [];
            const interiorOrigins = largest.filter(node => node.edges.length >= 2 && node.x > step && node.x < this.width - step
                && node.y > step && node.y < this.height - step);
            const origins = interiorOrigins.length ? interiorOrigins : largest;
            this.origin = origins[Math.floor(Math.random() * origins.length)];
            if (!this.origin) return;
            const base = [...this.nodes];
            const routes = shortest(this.nodes, this.origin);
            for (const food of this.foods) {
                const rect = food.rect;
                const ports = [];
                for (const t of [.2, .5, .8]) {
                    const x = rect.left + (rect.right - rect.left) * t;
                    const y = rect.top + (rect.bottom - rect.top) * t;
                    ports.push({ x, y: rect.top - 4 }, { x, y: rect.bottom + 4 },
                        { x: rect.left - 4, y }, { x: rect.right + 4, y });
                }
                const ranked = ports.filter(port => !this.blocked(port)).map(port => {
                    const candidates = base.filter(node => distance(port, node) < step * 3.4 && !this.blocked(port, node));
                    const score = Math.min(...candidates.map(node => (routes.distances[node.id] || 0) + distance(node, port)));
                    return { port, score, available: candidates.length };
                }).filter(item => item.available).sort((a, b) => a.score - b.score);
                if (!ranked.length) continue;
                const chosen = [ranked[0].port];
                const alternate = ranked.find(item => distance(item.port, chosen[0]) > Math.min(150, distance(
                    { x: rect.left, y: rect.top }, { x: rect.right, y: rect.bottom }) * .6));
                if (alternate && food.weight >= 2) chosen.push(alternate.port);
                for (const port of chosen) {
                    const node = this.attach(port, base);
                    if (!node) continue;
                    node.food = food.weight / chosen.length;
                    this.terminals.push(node);
                }
            }
            if (this.host.matches('.section')) {
                const bottom = this.attach({ x: 4, y: this.height - 4 }, [...this.nodes], true);
                if (bottom) { bottom.food = 1; this.terminals.push(bottom); }
            }

            // Small distributed demands keep useful veins reaching the whole free area.
            // They carry less demand than content and have no decorative endpoint markers.
            const regions = new Map();
            for (const node of base) {
                if (node.edges.length < 2 || node === this.origin || node.food
                    || this.terminals.some(terminal => distance(node, terminal) < step * 1.5)) continue;
                const column = Math.floor(node.x / 220);
                const row = Math.floor(node.y / 220);
                const key = `${column},${row}`;
                const center = { x: column * 220 + 110, y: row * 220 + 110 };
                if (!regions.has(key) || distance(node, center) < distance(regions.get(key), center)) regions.set(key, node);
            }
            for (const node of regions.values()) node.food += .22;
        }

        adapt() {
            this.sources = [];
            for (const component of components(this.nodes)) {
                const foods = component.filter(node => node.food);
                if (!foods.length) continue;
                const candidates = component.filter(node => !node.food && node.edges.length >= 2);
                const root = component.includes(this.origin) ? this.origin
                    : candidates[Math.floor(Math.random() * candidates.length)] || component[Math.floor(Math.random() * component.length)];
                root.source = true;
                root.food = 0;
                this.sources.push(root);
                const route = shortest(this.nodes, root);
                let maximum = this.spacing;
                for (const node of component) maximum = Math.max(maximum, route.distances[node.id]);
                for (const node of component) {
                    node.active = true;
                    node.birth = 200 + route.distances[node.id] / maximum * 6000;
                    node.pressure = node.source ? 1 : Math.exp(-route.distances[node.id] / (this.spacing * 8)) / (1 + node.food * 3);
                }
                for (const food of foods) {
                    let node = food;
                    let edge;
                    while ((edge = route.parents[node.id])) {
                        edge.traffic += food.food || 1;
                        node = edge.a === node ? edge.b : edge.a;
                    }
                }
            }
            this.edges = this.edges.filter(edge => edge.a.active && edge.b.active);
            const activeNodes = this.nodes.filter(node => node.active);
            for (const edge of this.edges) edge.conductance = .16 + Math.sqrt(edge.traffic) * .55;
            // Kirchhoff pressure balance, followed by flux-dependent tube adaptation.
            for (let round = 0; round < 12; round++) {
                for (let sweep = 0; sweep < 18; sweep++) {
                    for (const node of activeNodes) {
                        if (node.source) continue;
                        let pressure = 0;
                        let total = node.food * .1;
                        for (const edge of node.edges) {
                            const other = edge.a === node ? edge.b : edge.a;
                            const weight = edge.conductance / edge.cost;
                            pressure += other.pressure * weight;
                            total += weight;
                        }
                        if (total) node.pressure = pressure / total;
                    }
                }
                let peak = .000001;
                for (const edge of this.edges) {
                    edge.flux = Math.abs(edge.a.pressure - edge.b.pressure) * edge.conductance / edge.cost;
                    peak = Math.max(peak, edge.flux);
                }
                for (const edge of this.edges) {
                    const target = .018 + 3 * (edge.flux / peak) ** .7;
                    edge.conductance = edge.conductance * .65 + target * .35;
                }
            }
            const peak = Math.max(.000001, ...this.edges.map(edge => edge.flux));
            const traffic = Math.max(1, ...this.edges.map(edge => edge.traffic));
            for (const edge of this.edges) {
                edge.level = Math.max((edge.flux / peak) ** .5, Math.sqrt(edge.traffic / traffic) * .58);
                edge.thickness = .85 + edge.level * 6.5;
                if (edge.a.birth > edge.b.birth) [edge.a, edge.b] = [edge.b, edge.a];
                edge.start = edge.a.birth;
                edge.duration = Math.max(100, edge.b.birth - edge.a.birth + 100);
            }
            this.edges.sort((a, b) => a.level - b.level);
        }

        smoothConnections() {
            for (const edge of this.edges) {
                const tangent = (node, other) => {
                    const dx = other.x - node.x, dy = other.y - node.y;
                    const length = Math.hypot(dx, dy);
                    let opposite = null, score = -.15;
                    for (const adjacent of node.edges) {
                        if (adjacent === edge) continue;
                        const next = adjacent.a === node ? adjacent.b : adjacent.a;
                        const nx = next.x - node.x, ny = next.y - node.y;
                        const dot = (dx * nx + dy * ny) / (length * Math.hypot(nx, ny));
                        if (dot < score) { score = dot; opposite = next; }
                    }
                    if (!opposite) return { x: node.x + dx * .32, y: node.y + dy * .32 };
                    const tx = other.x - opposite.x, ty = other.y - opposite.y;
                    const scale = length * .36 / Math.hypot(tx, ty);
                    return { x: node.x + tx * scale, y: node.y + ty * scale };
                };
                const c1 = tangent(edge.a, edge.b), c2 = tangent(edge.b, edge.a);
                // The whole Bézier stays inside this obstacle-free control polygon.
                const hull = [edge.a, c1, c2, edge.b];
                const left = Math.min(...hull.map(p => p.x)), right = Math.max(...hull.map(p => p.x));
                const top = Math.min(...hull.map(p => p.y)), bottom = Math.max(...hull.map(p => p.y));
                const overlaps = this.protected.some(rect => left < rect.right && right > rect.left
                    && top < rect.bottom && bottom > rect.top);
                if (!overlaps && !this.blocked(edge.a, c1) && !this.blocked(c1, c2) && !this.blocked(c2, edge.b)
                    && !this.blocked(edge.a, c2) && !this.blocked(c1, edge.b)) {
                    edge.c1 = c1;
                    edge.c2 = c2;
                }
            }
        }

        curvePoint(edge, t) {
            const s = 1 - t;
            if (edge.c1) return {
                x: s ** 3 * edge.a.x + 3 * s * s * t * edge.c1.x + 3 * s * t * t * edge.c2.x + t ** 3 * edge.b.x,
                y: s ** 3 * edge.a.y + 3 * s * s * t * edge.c1.y + 3 * s * t * t * edge.c2.y + t ** 3 * edge.b.y
            };
            return {
                x: s * s * edge.a.x + 2 * s * t * edge.control.x + t * t * edge.b.x,
                y: s * s * edge.a.y + 2 * s * t * edge.control.y + t * t * edge.b.y
            };
        }

        startStreaming() {
            for (const node of this.nodes) node.streamEdges = [];
            for (const edge of this.edges) {
                edge.a.streamEdges.push(edge);
                edge.b.streamEdges.push(edge);
                // Sample curve lengths once so particles keep their speed around bends.
                edge.streamDistances = [0];
                let previous = edge.a;
                for (let i = 1; i <= 16; i++) {
                    const point = this.curvePoint(edge, i / 16);
                    edge.streamDistances.push(edge.streamDistances[i - 1] + distance(previous, point));
                    previous = point;
                }
                edge.streamLength = edge.streamDistances[16];
            }
            const candidates = this.edges.filter(edge => edge.level > .16);
            const count = Math.min(64, Math.ceil(this.width * this.height / 24000), candidates.length);
            this.particles = Array.from({ length: count }, (_, i) => {
                const edge = candidates[Math.floor(i * candidates.length / count)];
                return { edge, forward: Math.random() < .5, position: Math.random() * edge.streamLength,
                    speed: random(28, 46), radius: random(1.2, 1.9) };
            });
            this.streamTime = 0;
        }

        paintStreaming(context, time) {
            const delta = clamp(time - this.streamTime, 0, 80) / 1000;
            this.streamTime = time;
            if (motion.matches) return;
            context.fillStyle = `rgba(${this.lumen}, .95)`;
            for (const particle of this.particles) {
                if (time < particle.edge.start + particle.edge.duration + 300) continue;
                particle.position += particle.speed * delta;
                while (particle.position >= particle.edge.streamLength) {
                    const previous = particle.edge;
                    particle.position -= previous.streamLength;
                    const node = particle.forward ? previous.b : previous.a;
                    const choices = node.streamEdges.filter(edge => edge !== previous
                        && time >= edge.start + edge.duration + 300);
                    let next = previous;
                    if (choices.length) {
                        let choice = Math.random() * choices.reduce((sum, edge) => sum + .12 + edge.level, 0);
                        next = choices.find(edge => (choice -= .12 + edge.level) <= 0) || choices[choices.length - 1];
                    }
                    // Continue through a junction; turn around only at a grown dead end.
                    particle.edge = next;
                    particle.forward = next.a === node;
                }
                const edge = particle.edge;
                const along = particle.forward ? particle.position : edge.streamLength - particle.position;
                let i = 1;
                while (i < 16 && edge.streamDistances[i] < along) i++;
                const span = edge.streamDistances[i] - edge.streamDistances[i - 1];
                const t = (i - 1 + (along - edge.streamDistances[i - 1]) / span) / 16;
                const { x, y } = this.curvePoint(edge, t);
                context.beginPath();
                context.arc(x, y, particle.radius, 0, Math.PI * 2);
                context.fill();
            }
        }

        reset() {
            if (!this.context || !this.width || !this.height) return;
            const ratio = Math.min(devicePixelRatio || 1, 1.5);
            for (const canvas of [this.canvas, this.cache]) {
                canvas.width = Math.round(this.width * ratio);
                canvas.height = Math.round(this.height * ratio);
                const context = canvas.getContext('2d');
                context.setTransform(ratio, 0, 0, ratio, 0, 0);
                context.lineCap = 'round';
                context.lineJoin = 'round';
            }
            // Context-specific RGB values are defined together in colors.css.
            const palette = getComputedStyle(this.host);
            this.color = palette.getPropertyValue('--physarum-color-rgb').trim();
            this.lumen = palette.getPropertyValue('--physarum-lumen-rgb').trim();
            this.time = 0;
            this.cursorRoutes = [];
            this.sectionRoute = null;
            this.sectionTargetKey = '';
            this.cacheReady = false;
            this.buildMesh();
            this.adapt();
            this.smoothConnections();
            this.startStreaming();
            this.ready = true;
            this.done = false;
            if (motion.matches) this.finish();
            else this.render(0);
        }

        protect(context) {
            for (const rect of this.protected) context.clearRect(rect.left - 1, rect.top - 1,
                rect.right - rect.left + 2, rect.bottom - rect.top + 2);
        }

        cursorTarget(point) {
            const points = [{ x: clamp(point.x, 8, this.width - 8), y: clamp(point.y, 8, this.height - 8) }];
            for (const rect of this.protected) {
                if (point.x < rect.left - 8 || point.x > rect.right + 8 || point.y < rect.top - 8 || point.y > rect.bottom + 8) continue;
                const x = clamp(point.x, rect.left, rect.right);
                const y = clamp(point.y, rect.top, rect.bottom);
                points.push({ x: rect.left - 6, y }, { x: rect.right + 6, y },
                    { x, y: rect.top - 6 }, { x, y: rect.bottom + 6 });
            }
            const nodes = this.nodes.filter(node => node.active && node.edges.length);
            points.sort((a, b) => distance(point, a) - distance(point, b));
            for (const target of points) {
                if (this.blocked(target)) continue;
                const neighbours = nodes.filter(node => distance(node, target) < this.spacing * 3.4 && !this.blocked(node, target));
                if (neighbours.length) return { point: target, neighbours };
            }
            // Overlapping content blocks can hide all four sides: stop at the nearest free vein.
            const nearest = nodes.sort((a, b) => distance(point, a) - distance(point, b))[0];
            return nearest ? { point: { x: nearest.x, y: nearest.y }, neighbours: [nearest] } : null;
        }

        attract(point, sectionKey = '') {
            if (!this.ready) return;
            if (sectionKey && sectionKey === this.sectionTargetKey) return;
            const target = this.cursorTarget(point);
            if (!target) return;
            const previous = this.cursorRoutes[this.cursorRoutes.length - 1];
            if (!sectionKey && previous && distance(previous.point, target.point) < 10) return;
            const end = target.neighbours.sort((a, b) => distance(a, target.point) - distance(b, target.point))[0];
            const routes = shortest(this.nodes, end);
            const established = this.nodes.filter(node => node.active && (node.source || node.birth <= this.time) && Number.isFinite(routes.distances[node.id]));
            const arteries = established.filter(node => node.edges.some(edge => edge.level > .25));
            const starts = (arteries.length ? arteries : established).sort((a, b) => distance(a, target.point) - distance(b, target.point));
            const start = starts.find(node => distance(node, target.point) > 70) || starts[0];
            if (!start) return;
            const segments = [];
            let node = start;
            let edge;
            while ((edge = routes.parents[node.id])) {
                const next = edge.a === node ? edge.b : edge.a;
                segments.push({ a: node, b: next, control: edge.control, length: edge.length,
                    c1: node === edge.a ? edge.c1 : edge.c2,
                    c2: node === edge.a ? edge.c2 : edge.c1 });
                node = next;
            }
            const length = distance(end, target.point);
            if (length > .1) {
                segments.push({ a: end, b: target.point, length,
                    control: { x: (end.x + target.point.x) / 2, y: (end.y + target.point.y) / 2 } });
            }
            const total = segments.reduce((sum, segment) => sum + segment.length, 0);
            if (!total) return;
            const route = { segments, point: target.point, length: total, start: this.time,
                duration: clamp(total * 9, 900, 2800), priority: Boolean(sectionKey) };
            if (sectionKey) {
                this.sectionRoute = route;
                this.sectionTargetKey = sectionKey;
            } else {
                this.cursorRoutes.push(route);
                if (this.cursorRoutes.length > 5) this.cursorRoutes.shift();
            }
            // Resume a mature colony without regenerating its mesh or its random origin.
            this.done = false;
            if (motion.matches) this.finish();
            else { lastTime = 0; schedule(); }
        }

        followSection(point, key = '') {
            if (point) this.attract(point, key);
            else if (this.sectionRoute) {
                this.sectionRoute = null;
                this.sectionTargetKey = '';
                this.render(this.time);
            }
        }

        vein(context, edge, progress, thickness, level) {
            const t = clamp(progress, 0, 1);
            const s = 1 - t;
            const { a, b, control } = edge;
            context.beginPath();
            context.moveTo(a.x, a.y);
            const point = this.curvePoint(edge, t);
            if (edge.c1) {
                const c1 = { x: a.x + (edge.c1.x - a.x) * t, y: a.y + (edge.c1.y - a.y) * t };
                const c2 = {
                    x: s * s * a.x + 2 * s * t * edge.c1.x + t * t * edge.c2.x,
                    y: s * s * a.y + 2 * s * t * edge.c1.y + t * t * edge.c2.y
                };
                context.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, point.x, point.y);
            } else context.quadraticCurveTo(a.x + (control.x - a.x) * t, a.y + (control.y - a.y) * t, point.x, point.y);
            // Soft dark edges and a solid core give the network an ink-like body.
            context.lineWidth = thickness * 2 + 1.2;
            context.strokeStyle = `rgba(${this.color}, ${.045 + level * .065})`;
            context.stroke();
            context.lineWidth = thickness;
            context.strokeStyle = `rgba(${this.color}, ${.34 + level * .52})`;
            context.stroke();
            // Stable flecks follow the same curve, so texture never flickers.
            const steps = Math.max(2, Math.ceil(edge.length / 1.4));
            context.fillStyle = `rgba(${this.color}, ${.2 + level * .24})`;
            for (let i = 0; i <= steps * t; i++) {
                const u = i / steps;
                const seed = a.x * .73 + b.y * .37 + i * 2.399;
                const spread = Math.sin(seed * 7.13) * (thickness * 1.6 + 3);
                const { x, y } = this.curvePoint(edge, u);
                context.beginPath();
                context.arc(x + Math.cos(seed) * spread, y + Math.sin(seed) * spread,
                    .3 + (Math.sin(seed * 3.7) + 1) * .55, 0, Math.PI * 2);
                context.fill();
            }
        }

        paintAttractions(context, time) {
            const routes = this.sectionRoute ? [...this.cursorRoutes, this.sectionRoute] : this.cursorRoutes;
            for (const route of routes) {
                const progress = clamp((time - route.start) / route.duration, 0, 1);
                let remaining = progress * route.length;
                let travelled = 0;
                for (const segment of route.segments) {
                    if (remaining <= 0) break;
                    const thickness = route.priority ? 3.2 - travelled / route.length : 2.5 - travelled / route.length * 1.2;
                    this.vein(context, segment, remaining / segment.length, thickness, route.priority ? .98 : .85);
                    remaining -= segment.length;
                    travelled += segment.length;
                }
                if (progress === 1) {
                    context.beginPath();
                    context.arc(route.point.x, route.point.y, route.priority ? 3 : 2.5, 0, Math.PI * 2);
                    context.fillStyle = `rgba(${this.lumen}, .8)`;
                    context.fill();
                }
            }
        }

        attractionsGrowing() {
            return this.cursorRoutes.some(route => this.time < route.start + route.duration)
                || (this.sectionRoute && this.time < this.sectionRoute.start + this.sectionRoute.duration);
        }

        paint(context, time) {
            for (const edge of this.edges) {
                if (time <= edge.start) continue;
                const maturity = clamp((time - edge.start - edge.duration) / 1700, 0, 1);
                const thickness = edge.thickness * (.45 + .55 * maturity);
                this.vein(context, edge, (time - edge.start) / edge.duration, thickness, edge.level);
            }
            for (const node of [...this.sources, ...this.terminals]) {
                if (!node.active || time < node.birth + 300) continue;
                const radius = node.source ? 16 : 4 + Math.sqrt(node.food) * 1.5;
                context.beginPath();
                for (let i = 0; i <= 40; i++) {
                    const angle = i / 40 * Math.PI * 2;
                    const r = radius * (1 + .2 * Math.sin(angle * 7 + node.x) + .12 * Math.cos(angle * 11 + node.y));
                    const x = node.x + Math.cos(angle) * r * 1.25;
                    const y = node.y + Math.sin(angle) * r;
                    if (i === 0) context.moveTo(x, y);
                    else context.lineTo(x, y);
                }
                context.closePath();
                context.fillStyle = `rgba(${this.color}, .45)`;
                context.fill();
            }
            this.protect(context);
        }

        render(time) {
            const ink = this.context;
            ink.clearRect(0, 0, this.width, this.height);
            if (time >= GROW_TIME) {
                if (!this.cacheReady) {
                    this.paint(this.cache.getContext('2d'), GROW_TIME);
                    this.cacheReady = true;
                }
                ink.drawImage(this.cache, 0, 0, this.width, this.height);
            } else this.paint(ink, time);
            this.paintAttractions(ink, time);
            this.paintStreaming(ink, time);
            this.protect(ink);
        }

        finish() {
            const sectionEnd = this.sectionRoute ? this.sectionRoute.start + this.sectionRoute.duration : 0;
            this.time = Math.max(END_TIME, this.time, sectionEnd, ...this.cursorRoutes.map(route => route.start + route.duration));
            this.render(this.time);
            this.done = true;
        }
    }

    function needsFrame(colony) {
        // Visible vessels keep streaming after the network has finished growing.
        return colony.visible && colony.ready && (!motion.matches || !colony.done);
    }

    function tick(now) {
        frame = 0;
        if (document.hidden) return;
        const delta = lastTime ? now - lastTime : 33;
        if (delta >= 32) {
            lastTime = now;
            for (const colony of colonies) {
                if (!needsFrame(colony)) continue;
                if (motion.matches) colony.finish();
                else {
                    colony.time += Math.min(delta, 80);
                    colony.render(colony.time);
                    colony.done = colony.time >= END_TIME && !colony.attractionsGrowing();
                }
            }
        }
        schedule();
    }

    function schedule() {
        if (!frame && !document.hidden && colonies.some(needsFrame)) frame = requestAnimationFrame(tick);
    }

    function followActiveSection() {
        const menu = document.querySelector('.side-menu');
        const active = menu?.querySelector('a.active[href^="#"]');
        const button = active?.getBoundingClientRect();
        const menuRect = menu?.getBoundingClientRect();
        const available = button && button.width && button.height && menuRect.left < innerWidth && menuRect.right > 0
            && button.top < Math.min(innerHeight, menuRect.bottom) && button.bottom > Math.max(0, menuRect.top);
        for (const colony of colonies) {
            if (!colony.ready || !colony.visible) continue;
            if (!available) { colony.followSection(null); continue; }
            const rect = colony.host.getBoundingClientRect();
            const point = {
                x: clamp(menuRect.left - rect.left - 4, 4, colony.width - 4),
                y: clamp((button.top + button.bottom) / 2 - rect.top - colony.host.clientTop + colony.host.scrollTop, 4, colony.height - 4)
            };
            const key = `${active.getAttribute('href')}:${Math.round(point.x)},${Math.round(point.y)}`;
            colony.followSection(point, key);
        }
    }

    function queueLayout() {
        if (layoutFrame) return;
        layoutFrame = requestAnimationFrame(() => {
            layoutFrame = 0;
            for (const colony of colonies) {
                if (!colony.visible) continue;
                colony.measure();
                if (motion.matches && colony.ready && !colony.done) colony.finish();
            }
            followActiveSection();
            schedule();
        });
    }

    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        for (const entry of entries) {
            const colony = colonies.find(item => item.host === entry.target);
            colony.visible = entry.isIntersecting && entry.intersectionRatio >= .001;
            if (colony.visible) colony.measure();
        }
        followActiveSection();
        lastTime = 0;
        schedule();
    }, { threshold: .001 }) : null;
    const resize = 'ResizeObserver' in window ? new ResizeObserver(queueLayout) : null;
    for (const host of document.querySelectorAll('main > .section')) {
        const colony = new Colony(host);
        if (!colony.context) continue;
        colonies.push(colony);
        if (observer) observer.observe(host);
        else { colony.visible = true; colony.measure(); }
        if (resize) {
            resize.observe(host);
            host.querySelectorAll(protectedSelector).forEach(element => resize.observe(element));
        }
        host.addEventListener('transitionend', queueLayout);
        host.addEventListener('load', queueLayout, true);
        host.addEventListener('scroll', queueLayout, { passive: true });
    }
    motion.addEventListener('change', queueLayout);

    function cancelPointer() {
        clearTimeout(pointerTimer);
        pointerTimer = 0;
    }

    function waitForPointer() {
        cancelPointer();
        if (!pointer || document.hidden) return;
        pointerTimer = setTimeout(() => {
            pointerTimer = 0;
            if (!pointer || document.hidden) return;
            const element = document.elementFromPoint(pointer.x, pointer.y);
            const host = element?.closest('main > .section');
            const colony = colonies.find(item => item.host === host && item.visible && item.ready);
            if (!colony) return;
            const rect = colony.host.getBoundingClientRect();
            colony.attract({
                x: pointer.x - rect.left - colony.host.clientLeft + colony.host.scrollLeft,
                y: pointer.y - rect.top - colony.host.clientTop + colony.host.scrollTop
            });
        }, POINTER_DWELL);
    }

    document.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse' || event.buttons) return;
        if (pointer && Math.hypot(event.clientX - pointer.anchorX, event.clientY - pointer.anchorY) <= POINTER_TOLERANCE) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            return;
        }
        pointer = { x: event.clientX, y: event.clientY, anchorX: event.clientX, anchorY: event.clientY };
        waitForPointer();
    }, { passive: true });
    document.addEventListener('pointerdown', cancelPointer, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => { cancelPointer(); pointer = null; });
    window.addEventListener('blur', () => { cancelPointer(); pointer = null; });
    window.addEventListener('resize', () => { waitForPointer(); queueLayout(); });
    let scrollTimer;
    document.querySelector('main')?.addEventListener('scroll', () => {
        waitForPointer();
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(queueLayout, 120);
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { cancelPointer(); cancelAnimationFrame(frame); frame = 0; }
        else { lastTime = 0; queueLayout(); }
    });
    document.fonts?.ready.then(queueLayout);
    schedule();
})();
