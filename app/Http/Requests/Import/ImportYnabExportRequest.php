<?php

namespace App\Http\Requests\Import;

use Illuminate\Foundation\Http\FormRequest;

class ImportYnabExportRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'max:51200', 'mimetypes:application/zip,application/x-zip-compressed,application/octet-stream,text/csv,text/plain,text/tab-separated-values'],
            'date_order' => ['nullable', 'in:day-first,month-first'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'file.mimetypes' => __('Upload the .zip you downloaded from YNAB, or the Register.csv from inside it.'),
            'file.max' => __('That export is larger than 50 MB.'),
        ];
    }
}
