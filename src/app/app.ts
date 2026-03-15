import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, signal, AfterViewInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';

// We'll use dynamic imports for MediaPipe to avoid SSR issues if any, 
// though this app is configured for SSR, MediaPipe is browser-only.

interface City {
  id: number;
  name: string;
  lng: number;
  lat: number;
}

interface MapFeature {
  geometry: {
    type: string;
    coordinates: unknown[];
  };
}

interface MapData {
  features: MapFeature[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapCanvas') mapCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('inputVideo') inputVideo!: ElementRef<HTMLVideoElement>;

  statusMessage = signal('系统启动中...');
  isAlbumOpen = signal(false);
  albumTitle = signal('');
  albumImg = signal('');
  
  private ctx!: CanvasRenderingContext2D;
  private mapData: MapData | null = null;
  private systemScale = 1.0;
  private offsetX = 0;
  private offsetY = 0;
  private lastLeftHandPos: { x: number, y: number } | null = null;
  private visitedCities = new Set<number>();
  private cursorX = -100;
  private cursorY = -100;
  private hoverCity: City | null = null;
  private hoverStartTime = 0;
  private readonly HOVER_DURATION = 1000;
  private readonly MAP_BOUNDS = { minLng: 73.5, maxLng: 135.0, minLat: 18.0, maxLat: 53.6 };

  private capitals: City[] = [
    { id: 1, name: "北京", lng: 116.40, lat: 39.90 }, { id: 2, name: "天津", lng: 117.20, lat: 39.13 },
    { id: 3, name: "石家庄", lng: 114.48, lat: 38.03 }, { id: 4, name: "太原", lng: 112.53, lat: 37.87 },
    { id: 5, name: "呼和浩特", lng: 111.65, lat: 40.82 }, { id: 6, name: "沈阳", lng: 123.38, lat: 41.80 },
    { id: 7, name: "长春", lng: 125.35, lat: 43.88 }, { id: 8, name: "哈尔滨", lng: 126.63, lat: 45.75 },
    { id: 9, name: "上海", lng: 121.47, lat: 31.23 }, { id: 10, name: "南京", lng: 118.78, lat: 32.04 },
    { id: 11, name: "杭州", lng: 120.15, lat: 30.28 }, { id: 12, name: "合肥", lng: 117.27, lat: 31.86 },
    { id: 13, name: "福州", lng: 119.30, lat: 26.08 }, { id: 14, name: "南昌", lng: 115.89, lat: 28.68 },
    { id: 15, name: "济南", lng: 117.00, lat: 36.65 }, { id: 16, name: "郑州", lng: 113.65, lat: 34.76 },
    { id: 17, name: "武汉", lng: 114.31, lat: 30.52 }, { id: 18, name: "长沙", lng: 113.00, lat: 28.21 },
    { id: 19, name: "广州", lng: 113.23, lat: 23.16 }, { id: 20, name: "南宁", lng: 108.33, lat: 22.84 },
    { id: 21, name: "海口", lng: 110.35, lat: 20.02 }, { id: 22, name: "重庆", lng: 106.54, lat: 29.59 },
    { id: 23, name: "成都", lng: 104.06, lat: 30.67 }, { id: 24, name: "贵阳", lng: 106.71, lat: 26.57 },
    { id: 25, name: "昆明", lng: 102.73, lat: 25.04 }, { id: 26, name: "拉萨", lng: 91.11, lat: 29.66 },
    { id: 27, name: "西安", lng: 108.95, lat: 34.27 }, { id: 28, name: "兰州", lng: 103.73, lat: 36.03 },
    { id: 29, name: "西宁", lng: 101.74, lat: 36.56 }, { id: 30, name: "银川", lng: 106.27, lat: 38.47 },
    { id: 31, name: "乌鲁木齐", lng: 87.68, lat: 43.77 }
  ];

  private animationFrameId: number | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private camera: any = null;
  private isBrowser: boolean;
  private platformId = inject(PLATFORM_ID);

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
  }

  ngOnInit() {
    if (this.isBrowser) {
      this.fetchMapData();
    }
  }

  ngAfterViewInit() {
    if (this.isBrowser) {
      this.ctx = this.mapCanvas.nativeElement.getContext('2d')!;
      this.resize();
      window.addEventListener('resize', () => this.resize());
      this.initMediaPipe();
      this.render();
    }
  }

  ngOnDestroy() {
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    if (this.camera && typeof (this.camera as Record<string, unknown>)['stop'] === 'function') {
      (this.camera as { stop: () => void }).stop();
    }
  }

  private async fetchMapData() {
    try {
      const response = await fetch('https://geojson.cn/api/china/china.json');
      this.mapData = await response.json();
      this.statusMessage.set('神经链路已建立');
    } catch {
      this.statusMessage.set('数据链路上行错误');
    }
  }

  private resize() {
    const canvas = this.mapCanvas.nativeElement;
    const scale = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * scale;
    canvas.height = window.innerHeight * scale;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    this.ctx.resetTransform();
    this.ctx.scale(scale, scale);
  }

  private async initMediaPipe() {
    // Dynamically import to ensure browser-only execution
    const { Hands } = await import('@mediapipe/hands');
    const { Camera } = await import('@mediapipe/camera_utils');

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.5
    });

    hands.onResults((results) => this.onResults(results));

    this.camera = new Camera(this.inputVideo.nativeElement, {
      onFrame: async () => {
        await hands.send({ image: this.inputVideo.nativeElement });
      },
      width: 1280,
      height: 720
    });
    this.camera.start();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onResults(results: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lh: any = null, rh: any = null;
    if (results.multiHandLandmarks && results.multiHandedness) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.multiHandLandmarks.forEach((lm: any, i: number) => {
        if (results.multiHandedness && results.multiHandedness[i].label === 'Left') rh = lm; else lh = lm;
      });
    }

    const w = window.innerWidth, h = window.innerHeight;

    if (rh) {
      const indexTip = rh[8];
      this.cursorX = (1 - indexTip.x) * w;
      this.cursorY = indexTip.y * h;

      const isOpen = rh[8].y < rh[6].y && rh[12].y < rh[10].y && rh[16].y < rh[14].y;
      const isFist = rh[8].y > rh[6].y && rh[12].y > rh[10].y && rh[16].y > rh[14].y;

      if (isOpen) {
        this.systemScale = Math.min(4.0, this.systemScale + 0.03);
        this.statusMessage.set('放大视图');
      } else if (isFist) {
        this.systemScale = Math.max(0.5, this.systemScale - 0.03);
        if (this.isAlbumOpen()) {
          this.closeAlbum();
          this.statusMessage.set('相册已关闭');
        } else {
          this.statusMessage.set('缩小视图');
        }
      }
    } else {
      this.cursorX = -100;
    }

    if (lh && lh[8].y < lh[6].y) {
      const center = lh[9];
      if (this.lastLeftHandPos) {
        this.offsetX += (center.x - this.lastLeftHandPos.x) * -2000;
        this.offsetY += (center.y - this.lastLeftHandPos.y) * 2000;
      }
      this.lastLeftHandPos = { x: center.x, y: center.y };
      this.statusMessage.set('平移视图');
    } else {
      this.lastLeftHandPos = null;
    }
  }

  private project(lng: number, lat: number, w: number, h: number) {
    const px = (lng - this.MAP_BOUNDS.minLng) / (this.MAP_BOUNDS.maxLng - this.MAP_BOUNDS.minLng) * w;
    const py = h - (lat - this.MAP_BOUNDS.minLat) / (this.MAP_BOUNDS.maxLat - this.MAP_BOUNDS.minLat) * h;
    return { x: px, y: py };
  }

  private render() {
    this.drawMap();
    this.animationFrameId = requestAnimationFrame(() => this.render());
  }

  private drawMap() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.clearRect(0, 0, w, h);

    this.ctx.save();
    this.ctx.translate(w / 2 + this.offsetX, h / 2 + this.offsetY);
    this.ctx.scale(this.systemScale, this.systemScale);
    this.ctx.translate(-w / 2, -h / 2);

    // Draw Map Outline
    this.drawLayer(w, h, 'rgba(255, 0, 0, 0.6)', 2, 12);

    let currentHover: City | null = null;
    this.capitals.forEach(city => {
      const pos = this.project(city.lng, city.lat, w, h);
      const isVisited = this.visitedCities.has(city.id);
      
      const mapCursorX = (this.cursorX - w/2 - this.offsetX) / this.systemScale + w/2;
      const mapCursorY = (this.cursorY - h/2 - this.offsetY) / this.systemScale + h/2;
      
      const dist = Math.hypot(pos.x - mapCursorX, pos.y - mapCursorY);
      const isTargeted = dist < 15;

      if (isTargeted) currentHover = city;

      this.ctx.beginPath();
      this.ctx.shadowBlur = (isTargeted ? 30 : 10);
      this.ctx.shadowColor = isTargeted ? '#fff' : (isVisited ? '#ff6600' : '#00ffff');
      this.ctx.fillStyle = isTargeted ? '#fff' : (isVisited ? '#ff6600' : '#00ffff');
      this.ctx.arc(pos.x, pos.y, isTargeted ? 6 : 3, 0, Math.PI * 2);
      this.ctx.fill();

      if (this.systemScale > 1.2 || isTargeted) {
        this.ctx.font = isTargeted ? 'bold 12px sans-serif' : '10px sans-serif';
        this.ctx.fillStyle = '#fff';
        this.ctx.fillText(city.name, pos.x + 12, pos.y + 5);
      }
    });

    this.updateHoverTimer(currentHover);
    this.ctx.restore();
    this.drawCursor();
  }

  private updateHoverTimer(city: City | null) {
    if (city && !this.isAlbumOpen()) {
      if (this.hoverCity !== city) {
        this.hoverCity = city;
        this.hoverStartTime = Date.now();
      } else {
        const elapsed = Date.now() - this.hoverStartTime;
        if (elapsed >= this.HOVER_DURATION) {
          this.openAlbum(city);
          this.visitedCities.add(city.id);
          this.hoverCity = null;
        }
      }
    } else if (!city) {
      this.hoverCity = null;
      this.hoverStartTime = 0;
    }
  }

  private drawCursor() {
    if (this.cursorX < 0) return;
    this.ctx.save();
    this.ctx.translate(this.cursorX, this.cursorY);
    this.ctx.strokeStyle = '#00ffff';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(0, 0, 18, 0, Math.PI * 2);
    this.ctx.stroke();
    
    if (this.hoverCity) {
      const progress = (Date.now() - this.hoverStartTime) / this.HOVER_DURATION;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, 24, -Math.PI/2, -Math.PI/2 + Math.PI*2 * progress);
      this.ctx.strokeStyle = '#ff3333';
      this.ctx.lineWidth = 4;
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawLayer(w: number, h: number, color: string, lw: number, blur: number) {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lw;
    this.ctx.shadowBlur = blur;
    this.ctx.shadowColor = color;
    if (this.mapData) {
      this.mapData.features.forEach((f: MapFeature) => {
        this.ctx.beginPath();
        const coords = f.geometry.coordinates;
        if (f.geometry.type === 'Polygon') this.renderRings(coords, w, h);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else coords.forEach((poly: any) => this.renderRings(poly, w, h));
        this.ctx.stroke();
      });
    }
    this.ctx.restore();
  }

  private renderRings(rings: unknown[], w: number, h: number) {
    rings.forEach(ring => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ring as any[]).forEach((c, i) => {
        const p = this.project(c[0], c[1], w, h);
        if (i === 0) this.ctx.moveTo(p.x, p.y); else this.ctx.lineTo(p.x, p.y);
      });
    });
  }

  openAlbum(city: City) {
    this.albumTitle.set(city.name);
    this.albumImg.set(`https://picsum.photos/seed/${city.id + 100}/1200/800`);
    this.isAlbumOpen.set(true);
  }

  closeAlbum() {
    this.isAlbumOpen.set(false);
  }
}
