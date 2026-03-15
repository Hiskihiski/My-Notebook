import { ErrorHandler, Injectable } from '@angular/core';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  handleError(error: any) {
    // 1. Log to console for your immediate debugging
    console.error('Caught by GlobalErrorHandler:', error);

    // 2. In a real-world app, you would send this to an error service here
    // e.g., this.errorService.log(error);
  }
}