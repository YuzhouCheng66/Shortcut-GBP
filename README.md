# Shortcut GBP Grid Demo

An interactive browser demo for experimenting with **Gaussian Belief Propagation (GBP)** on a 2D grid, with optional **shortcut edges** that accelerate message passing by creating temporary nonlocal correction channels.

Open the demo here:

```text
https://yuzhoucheng66.github.io/Shortcut-GBP/
```

No installation is needed. Everything runs in the browser.

---

## What you can do

This demo lets you:

- build an `n × n` Gaussian grid factor graph;
- run standard Gaussian BP step by step;
- add random shortcut edges automatically;
- add manual shortcut edges by clicking two nodes;
- refresh shortcut targets every `R` iterations;
- anneal shortcut precision to zero;
- compare residual, energy gap, and MAP error over time.

The main goal is to visualize how nonlocal shortcut connections change the dynamics of GBP.

---

## Layout

The page has three panels.

| Panel | Purpose |
|---|---|
| Left panel | Build the graph, choose parameters, add shortcuts, and run GBP. |
| Center panel | Visualize the grid, node values, and shortcut edges. |
| Right panel | Track residual, energy gap, MAP error, graph stats, and solver info. |

Shortcut edge colors:

| Color | Meaning |
|---|---|
| Cyan | Random shortcut edge. |
| Yellow / amber | Manual shortcut edge. |

---

## Quick start

### 1. Build a standard grid

Use the default settings, then click:

```text
Build + solve MAP
```

This creates the grid and computes the MAP reference solution once.

Then click:

```text
Run GBP
```

The residual / energy / MAP error curves will appear at the bottom.

---

### 2. Run standard GBP only

Use:

| Parameter | Value |
|---|---:|
| random shortcut count | `0` |
| dynamic random | off |
| anneal shortcut precision to zero | off |

Then click:

```text
Build + solve MAP
Run GBP
```

This shows the baseline GBP behavior on the original grid.

---

### 3. Run dynamic random shortcut GBP

A strong default setting is:

| Parameter | Value |
|---|---:|
| grid size `n×n` | `10` |
| prior precision `p₀` | `1` |
| grid edge precision `w` | `100` |
| edge observation mode | `noisy measurement` |
| random shortcut count | `10` |
| shortcut precision | `3000` |
| target z for shortcuts | `current: z=μᵢ−μⱼ` |
| belief readout | `base-only` |
| dynamic random | on |
| refresh period `R` | `2` |
| anneal shortcut precision to zero | off |
| GBP steps per click | `100` |
| metric every k steps | `10` |
| damping | `0` |

Then click:

```text
Build + solve MAP
Run GBP
```

This setting creates 10 random non-grid shortcut edges, refreshes them every 2 GBP iterations, and uses the current belief difference as the shortcut target:

```text
z_ij = μ_i - μ_j
```

This is the main “current-target shortcut” experiment.

---

### 4. Add manual shortcut edges

To manually add a shortcut:

1. Click one node in the grid.
2. Click another node.
3. A yellow shortcut edge will appear.

Manual shortcut edges are persistent. They are not removed by dynamic random refreshes.

Every `R` iterations, manual shortcut edges refresh their target as:

```text
z_ij = μ_i - μ_j
```

and their messages are reset.

This makes manual shortcuts useful for static-edge ablation experiments.

---

## Main buttons

| Button | What it does |
|---|---|
| Build + solve MAP | Builds a new grid and solves the MAP reference once. |
| Recompute MAP once | Recomputes the MAP reference for the current base graph. |
| Add random | Adds the specified number of random shortcut edges. |
| Clear | Removes all shortcut edges. |
| Refresh targets | Updates shortcut targets and resets shortcut messages. |
| Reset messages | Clears all GBP messages and resets iteration count. |
| Run GBP | Runs GBP from the current message state. |
| Stop | Stops after the current browser computation finishes. |

---

## Important parameters

### Grid parameters

| Parameter | Meaning |
|---|---|
| grid size `n×n` | Number of variables is `n²`. |
| prior precision `p₀` | Strength of the unary prior. Larger means stronger trust in the prior field. |
| grid edge precision `w` | Edge precision, equal to `1 / σ²`. For example, `w = 100` means `σ = 0.1`. |
| seed | Random seed for reproducible graph generation. |
| prior field | Shape of the prior signal. |
| edge observation mode | Chooses how grid edge observations are generated. |

### Edge observation modes

| Mode | Meaning |
|---|---|
| smoothing | Grid edges use `z = 0`, encouraging neighboring variables to be equal. |
| noisy measurement | A latent field is generated, and each edge observes a noisy relative measurement. |

In noisy measurement mode, grid factors have the form:

```text
exp[-0.5 * w * (x_i - x_j - z_ij)^2]
```

where `w = 1 / σ²`.

---

## Shortcut parameters

| Parameter | Meaning |
|---|---|
| random shortcut count | Number of random shortcut edges to add. |
| shortcut precision | Precision of shortcut factors. |
| target z for shortcuts | How the shortcut displacement target is chosen. |
| belief readout | Whether metrics read beliefs from the base graph only or the full graph. |
| dynamic random | Resample random shortcuts every `R` iterations. |
| anneal shortcut precision to zero | Gradually reduce shortcut precision to zero over `K` iterations. |
| refresh period `R` | Number of GBP iterations between shortcut target refreshes. |
| anneal `K` | Number of iterations over which shortcut precision is annealed to zero. |

### Shortcut target modes

| Target mode | Meaning |
|---|---|
| current: `z=μᵢ−μⱼ` | Zero-residual shortcut. It transports correction information without immediately forcing displacement. |
| prior: `z=yᵢ−yⱼ` | Uses prior differences as shortcut targets. |
| zero: `z=0` | Forces shortcut endpoints toward equality. Useful for smoothing experiments, but can bias measurement graphs. |

The most important mode is:

```text
current: z=μᵢ−μⱼ
```

This creates a zero-residual metric shortcut. It does not add a new physical measurement; instead, it changes the propagation geometry of GBP.

---

## Metrics

The right panel reports:

| Metric | Meaning |
|---|---|
| residual / initial | `||b - A μ|| / ||b - A y||` |
| energy gap | Difference between current energy and MAP energy. |
| relative gap | Energy gap normalized by the initial energy gap. |
| MAP error | `||μ - x*|| / ||x*||` |

The MAP reference `x*` is solved once when the graph is built.

---

## Recommended experiments

### Baseline standard GBP

```text
random shortcut count = 0
dynamic random = off
```

### Dynamic random shortcut GBP

```text
random shortcut count = 10
shortcut precision = 3000
target z = current: z=μᵢ−μⱼ
dynamic random = on
refresh period R = 2
```

### Static manual shortcut ablation

```text
random shortcut count = 0
shortcut precision = 3000
dynamic random = off
refresh period R = 2
```

Then manually click pairs of nodes to add persistent shortcut edges.

### Annealed shortcut experiment

```text
anneal shortcut precision to zero = on
anneal K = 200
```

This uses shortcut edges as a transient accelerator and gradually removes their effect.

---

## Notes

- The demo is intended for interactive exploration, not large-scale production solving.
- For smooth performance, start with `n = 10` or `n = 20`.
- Very large shortcut counts can slow down the browser and may also hurt convergence by over-constraining the correction field.
- The best practical shortcut strategy is usually not “add as many edges as possible,” but “add a small or moderate number of refreshed nonlocal correction channels.”

---

## Core idea

Standard GBP on a grid spreads information locally. A current-target shortcut edge creates a temporary nonlocal channel:

```text
z_ij = μ_i - μ_j
```

This means the shortcut does not immediately pull the current solution toward a new measurement. Instead, it helps transport correction information between distant nodes.

In short:

```text
standard GBP = local correction diffusion
shortcut GBP = nonlocal correction transport
```

