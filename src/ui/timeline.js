// Graphical keyframe timeline pinned to the bottom of the screen. Shows the 12
// structured keyframes as clickable markers; clicking one jumps to it for
// posing. A playhead tracks the current clip time.
export function createTimeline({ defs, onJump, onPrev, onNext, onPlay }) {
  const wrap = document.createElement('div');
  wrap.id = 'timeline';
  wrap.innerHTML = `
    <button class="tl-btn" data-act="play" title="Play / pause">▶︎</button>
    <button class="tl-btn" data-act="prev" title="Previous keyframe">⟨</button>
    <div class="tl-track"><div class="tl-playhead"></div></div>
    <button class="tl-btn" data-act="next" title="Next keyframe">⟩</button>`;
  document.body.appendChild(wrap);

  const track = wrap.querySelector('.tl-track');
  const playhead = wrap.querySelector('.tl-playhead');
  const btns = defs.map((d, i) => {
    const b = document.createElement('button');
    b.className = 'tl-key';
    b.style.left = `${d.t * 100}%`;
    b.innerHTML = `<span class="tl-dot"></span><span class="tl-lbl">${i + 1}·${d.label}</span>`;
    b.addEventListener('click', () => onJump(i));
    track.appendChild(b);
    return b;
  });

  wrap.querySelector('[data-act="prev"]').addEventListener('click', onPrev);
  wrap.querySelector('[data-act="next"]').addEventListener('click', onNext);
  wrap.querySelector('[data-act="play"]').addEventListener('click', onPlay);

  return {
    update(scrub) { playhead.style.left = `${scrub * 100}%`; },
    setActive(i) { btns.forEach((b, j) => b.classList.toggle('active', j === i)); },
  };
}
