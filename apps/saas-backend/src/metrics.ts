// Minimal Prometheus metrics registry.
//
// Self-contained (no external deps) so the backend can expose /metrics without
// adding a client library. Renders the standard Prometheus text exposition
// format (https://prometheus.io/docs/instrumenting/exposition_formats/).

type Labels = Record<string, string>;

/** Render a label set as `{k="v",...}` with keys sorted for stable output. */
function labelKey(labels: Labels): string {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return '{' + entries.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

abstract class Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly type: 'counter' | 'gauge' | 'histogram',
  ) {}
  abstract render(): string;
}

class Counter extends Metric {
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }

  inc(labels: Labels = {}, amount = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + amount);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }
}

class Gauge extends Metric {
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, 'gauge');
  }

  set(labels: Labels, value: number): void {
    this.values.set(labelKey(labels), value);
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, value] of this.values) {
      lines.push(`${this.name}${key} ${value}`);
    }
    return lines.join('\n');
  }
}

interface HistogramEntry {
  labels: Labels;
  counts: number[];
  sum: number;
  total: number;
}

class Histogram extends Metric {
  private readonly buckets: number[];
  private readonly entries = new Map<string, HistogramEntry>();

  constructor(name: string, help: string, buckets: number[]) {
    super(name, help, 'histogram');
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(labels: Labels, value: number): void {
    const key = labelKey(labels);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, total: 0 };
      this.entries.set(key, entry);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.counts[i]++;
    }
    entry.sum += value;
    entry.total++;
  }

  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const entry of this.entries.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += entry.counts[i];
        lines.push(`${this.name}_bucket${labelKey({ ...entry.labels, le: String(this.buckets[i]) })} ${cumulative}`);
      }
      lines.push(`${this.name}_bucket${labelKey({ ...entry.labels, le: '+Inf' })} ${entry.total}`);
      lines.push(`${this.name}_sum${labelKey(entry.labels)} ${entry.sum}`);
      lines.push(`${this.name}_count${labelKey(entry.labels)} ${entry.total}`);
    }
    return lines.join('\n');
  }
}

export class Metrics {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.metrics.push(c);
    return c;
  }

  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.metrics.push(g);
    return g;
  }

  histogram(name: string, help: string, buckets: number[]): Histogram {
    const h = new Histogram(name, help, buckets);
    this.metrics.push(h);
    return h;
  }

  /** Render all metrics in Prometheus text exposition format. */
  render(): string {
    return this.metrics.map((m) => m.render()).join('\n') + '\n';
  }
}
