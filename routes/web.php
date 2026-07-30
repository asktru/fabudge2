<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DictationController;
use App\Http\Controllers\SyncController;
use App\Http\Controllers\Teams\TeamInvitationController;
use App\Http\Middleware\EnsureTeamMembership;
use Illuminate\Support\Facades\Route;

Route::inertia('/', 'Welcome')->name('home');

Route::prefix('{current_team}')
    ->middleware(['auth', 'verified', EnsureTeamMembership::class])
    ->group(function () {
        Route::get('dashboard', DashboardController::class)->name('dashboard');
        Route::inertia('budget', 'Budget')->name('budget');
        Route::post('sync/push', [SyncController::class, 'push'])->name('sync.push');
        Route::get('sync/pull', [SyncController::class, 'pull'])->name('sync.pull');
        Route::post('dictation/parse', [DictationController::class, 'parse'])->name('dictation.parse');
    });

Route::middleware(['auth'])->group(function () {
    Route::get('invitations/{invitation}/accept', [TeamInvitationController::class, 'accept'])->name('invitations.accept');
    Route::delete('invitations/{invitation}', [TeamInvitationController::class, 'decline'])->name('invitations.decline');
});

require __DIR__.'/settings.php';
