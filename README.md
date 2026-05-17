# Shortcut GBP

A small, fast, browser-only playground for **Gaussian Belief Propagation on a grid**.

Open the demo here:

```text
https://yuzhoucheng66.github.io/Shortcut-GBP/
```

Everything runs in the browser. No Python server is needed.

---

## What to try first

The page opens with the recommended shortcut setting already loaded:

| setting | default |
|---|---:|
| grid | `10 × 10` |
| prior precision `p₀` | `1` |
| grid edge precision `w` | `100` |
| random shortcuts | `10` |
| shortcut precision | `3000` |
| max grid size | `100 × 100` |
| shortcut target | `current: z = xₜ,i − xₜ,j` |
| dynamic refresh | on |
| refresh period `R` | `2` |
| GBP steps per click | `70` |
| metric interval | `1` |
| damping | `0` |

Just click:

```text
Run GBP
```

You should see residual, energy gap, and MAP error update smoothly.

---

## The three panels

| panel | what it does |
|---|---|
| left | choose grid / shortcut settings and run GBP |
| center | see the grid, node values, and shortcut edges |
| right | track residual, energy gap, MAP error, and graph stats |

Shortcut colors:

| color | meaning |
|---|---|
| cyan | random shortcut |
| amber | manual shortcut |

---

## Main buttons

| button | use it for |
|---|---|
| **Build + solve MAP** | rebuild the grid and compute the MAP reference once |
| **Run GBP** | continue GBP from the current message state |
| **Add random** | add the chosen number of random shortcuts |
| **Clear** | remove all shortcuts |
| **Refresh targets** | recompute shortcut targets and clear shortcut messages |
| **Reset messages** | keep the graph, but reset GBP messages to zero |
| **Stop** | stop after the current browser computation yields |

Manual shortcuts: click one node, then another node. Manual edges stay fixed, but every `R` steps their target is refreshed as

```text
z_ij = xₜ,i - xₜ,j
```

and their messages are reset.

---

## Key parameters

### Grid

| parameter | meaning |
|---|---|
| `grid size n×n` | number of variables is `n²` |
| `prior precision p₀` | strength of unary priors |
| `grid edge precision w` | edge precision, equal to `1 / σ²` |
| `prior field` | initial unary signal |
| `smoothing` | grid edges use `z = 0`, encouraging neighbors to match |
| `noisy measurement` | grid edges observe `z = x*ᵢ − x*ⱼ + ε` |

### Shortcuts

| parameter | meaning |
|---|---|
| `random shortcut count` | how many random non-grid edges to add |
| `shortcut precision` | strength of shortcut factors |
| `target z for shortcuts` | how shortcut displacement targets are chosen |
| `base-only` | evaluate beliefs using original grid messages only |
| `dynamic random` | resample random shortcuts every `R` steps |
| `anneal` | gradually reduce shortcut precision to zero over `K` steps |

The main shortcut mode is:

```text
current: z = xₜ,i - xₜ,j
```

This creates a **zero-residual shortcut**. It does not add a new physical measurement; it changes how correction information moves through GBP.

---

## Metrics

| metric | definition |
|---|---|
| residual / initial | `‖b - A xₜ‖ / ‖b - A x₀‖` |
| energy gap / initial | `(E(xₜ) - E*) / (E(x₀) - E*)` |
| MAP error | `‖xₜ - x*‖ / ‖x*‖` |

The MAP reference `x*` is solved once when the graph is built.

---

## Intuition

Standard GBP moves corrections locally across grid edges.

Shortcut GBP adds temporary nonlocal correction channels:

```text
standard GBP  = local correction diffusion
shortcut GBP  = nonlocal correction transport
```

The default setting shows this effect quickly.
