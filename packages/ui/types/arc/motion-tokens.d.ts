/** Motion presets are shared by the gallery and future registry consumers. */
export declare const motionTokens: {
    /** Interface motion stays under 300ms; exits are quicker than entries. `considered` is for the rare larger reveal. */
    readonly duration: {
        readonly instant: 0.1;
        readonly fast: 0.15;
        readonly exit: 0.14;
        readonly standard: 0.2;
        readonly considered: 0.36;
    };
    readonly ease: {
        readonly enter: readonly [0.16, 1, 0.3, 1];
        readonly exit: readonly [0.7, 0, 0.84, 0];
        readonly standard: readonly [0.22, 1, 0.36, 1];
        /** For elements that move while already on screen. */
        readonly inOut: readonly [0.65, 0, 0.35, 1];
    };
    readonly spring: {
        readonly responsive: {
            readonly type: "spring";
            readonly stiffness: 520;
            readonly damping: 44;
        };
        readonly gentle: {
            readonly type: "spring";
            readonly stiffness: 340;
            readonly damping: 34;
        };
        /** Presses, toggles, thumbs, and small indicators. Settles fast and never overshoots, so nothing jitters. */
        readonly snappy: {
            readonly type: "spring";
            readonly visualDuration: 0.2;
            readonly bounce: 0;
        };
        /** Panels, height changes, and layout shifts. Critically damped, never overshoots. */
        readonly smooth: {
            readonly type: "spring";
            readonly visualDuration: 0.3;
            readonly bounce: 0;
        };
        /** Shape morphs, shared layout highlights, and width changes that follow new content. No bounce: sizes and positions settle without overshoot. */
        readonly morph: {
            readonly type: "spring";
            readonly visualDuration: 0.3;
            readonly bounce: 0;
        };
    };
    /** Stagger steps in seconds. Keep total stagger under roughly 0.4s. */
    readonly stagger: {
        readonly char: 0.016;
        readonly word: 0.04;
        readonly line: 0.08;
        readonly item: 0.035;
    };
    /** Blur radii in px for text and content crossfades. Keep blur small and brief. */
    readonly blur: {
        readonly subtle: 2;
        readonly soft: 4;
        readonly text: 8;
    };
};
