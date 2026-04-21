import { HttpInterceptorFn, HttpRequest, HttpHandlerFn, HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

export const AuthInterceptor: HttpInterceptorFn = (request: HttpRequest<any>, next: HttpHandlerFn): Observable<HttpEvent<any>> => {
  // Skip S3 direct uploads — they use a presigned URL, not our JWT
  if (request.url.includes('amazonaws.com')) {
    return next(request);
  }

  const token = localStorage.getItem('token');
  if (token) {
    request = request.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }

  const router = inject(Router);

  return next(request).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        // Token is expired or invalid — clear session and redirect to login
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        router.navigate(['/home']);
      }
      return throwError(() => err);
    })
  );
};
