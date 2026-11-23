import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  token = '';

  private headers(extra?: Record<string, string>) {
    let h = new HttpHeaders({ 'Content-Type': 'application/json' });
    if (this.token) h = h.set('Authorization', 'Bearer ' + this.token);
    Object.entries(extra || {}).forEach(([k, v]) => (h = h.set(k, v)));
    return h;
  }
  private url(p: string) { return environment.apiUrl + '/api' + p; }

  private async run<T>(o: Promise<T>): Promise<T> {
    try { return await o; } catch (e) {
      const err = e as HttpErrorResponse;
      const msg = (err.error && err.error.error) || (err.status === 0 ? 'Server not reachable – check internet / API' : 'Error ' + err.status);
      throw Object.assign(new Error(msg), { status: err.status });
    }
  }
  get<T>(p: string) { return this.run(firstValueFrom(this.http.get<T>(this.url(p), { headers: this.headers() }))); }
  post<T>(p: string, body: unknown) { return this.run(firstValueFrom(this.http.post<T>(this.url(p), body, { headers: this.headers() }))); }
  put<T>(p: string, body: unknown) { return this.run(firstValueFrom(this.http.put<T>(this.url(p), body, { headers: this.headers() }))); }
  del<T>(p: string, pin?: string) {
    return this.run(firstValueFrom(this.http.delete<T>(this.url(p), { headers: this.headers(pin ? { 'x-delete-pin': pin } : undefined) })));
  }
}
