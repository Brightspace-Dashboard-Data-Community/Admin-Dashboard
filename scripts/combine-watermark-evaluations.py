#!/usr/bin/env python3
"""Combine per-course Watermark evaluation workbooks into one CSV.

Watermark's project download is one Excel file per course. Each workbook has a
RawData sheet (one row per response) and a QuestionMapper sheet. This script
reads every workbook in a folder and writes one response-level CSV the faculty
evaluation page can load.

CoursePrefix is the offering code before the first hyphen (BIO-153W-... becomes
BIO), which is the same prefix Division Information uses. InstructorFromTitle
and InstructorEmail are the fields a full-time versus adjunct list can join on.
Instructor names appended to question text are removed so the same question
lines up across courses.

User IP addresses are left out. They are not used for scores.

Run it from the folder of Excel files with no arguments. The CSV is written
next to those files as watermark-evaluations.csv.

    python3 combine-watermark-evaluations.py

Or pass the folder and output path:

    python3 scripts/combine-watermark-evaluations.py ~/Downloads/watermark-winter -o watermark-evaluations.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import OrderedDict
from datetime import date, datetime
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required. Install it with: python3 -m pip install --user openpyxl")


RAW_SHEET = "rawdata"
MAP_SHEET = "questionmapper"
QUESTION_HEADER = re.compile(r"^question\s+(\d+)$", re.IGNORECASE)

IDENTITY_COLUMNS = [
    "SourceFile",
    "ResponseUniqueId",
    "OrgDefinedId",
    "Path",
    "LevelName",
    "LevelID",
    "CourseCode",
    "CoursePrefix",
    "CourseTitle",
    "InstructorFromTitle",
    "UniqueID",
    "SurveyStart",
    "SurveyEnd",
    "InstructorName",
    "InstructorUsername",
    "InstructorEmail",
    "InstructorEnrollments",
    "TAEnrollments",
    "Enrollments",
    "Respondents",
    "ResponseRate",
    "SubmitDate",
    "SubmitDevice",
    "RemoteLocationCode",
]

# Present on the Watermark sheet, omitted from the combined file.
SKIP_SOURCE_COLUMNS = {"userip"}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("folder", nargs="?", type=Path, help="Folder of per-course Watermark .xlsx files. Defaults to the folder you ran the script from.")
    parser.add_argument("-o", "--output", type=Path, help="Combined CSV path. Defaults to watermark-evaluations.csv in that folder.")
    args = parser.parse_args()

    folder = (args.folder or default_folder()).expanduser().resolve()
    if not folder.is_dir():
        print(f"Not a folder: {folder}", file=sys.stderr)
        return 1

    workbooks = sorted(
        path for path in folder.rglob("*.xlsx")
        if path.is_file() and not path.name.startswith("~$") and not path.name.startswith(".")
    )
    if not workbooks:
        print(f"No .xlsx files in {folder}", file=sys.stderr)
        return 1

    question_text: "OrderedDict[int, str]" = OrderedDict()
    rows: list[dict] = []
    seen_ids: dict[str, str] = {}
    used_files = 0
    skipped_files: list[str] = []
    duplicate_rows = 0
    courses: set[str] = set()

    for path in workbooks:
        parsed = read_workbook(path)
        if parsed is None:
            skipped_files.append(path.name)
            continue
        file_questions, file_rows = parsed
        if not file_rows:
            skipped_files.append(f"{path.name} (no responses)")
            continue
        mismatch = question_mismatch(question_text, file_questions, path.name)
        if mismatch:
            print(mismatch, file=sys.stderr)
            return 1
        for number, text in file_questions.items():
            question_text.setdefault(number, text)
        used_files += 1
        for row in file_rows:
            response_id = row.get("ResponseUniqueId", "")
            if response_id:
                previous = seen_ids.get(response_id)
                if previous:
                    duplicate_rows += 1
                    continue
                seen_ids[response_id] = path.name
            if row.get("CourseCode"):
                courses.add(row["CourseCode"])
            rows.append(row)

    if not rows:
        print("No response rows found. The workbooks need a RawData sheet.", file=sys.stderr)
        if skipped_files:
            print("Skipped: " + ", ".join(skipped_files), file=sys.stderr)
        return 1

    question_headers = [
        question_column(number, question_text[number])
        for number in sorted(question_text)
    ]
    fieldnames = IDENTITY_COLUMNS + question_headers
    output = (args.output or (folder / "watermark-evaluations.csv")).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})

    print(f"Wrote {len(rows)} responses from {len(courses)} {plural(len(courses), 'course')} in {used_files} {plural(used_files, 'file')}.")
    print(f"Output: {output}")
    if duplicate_rows:
        print(f"Skipped {duplicate_rows} duplicate {plural(duplicate_rows, 'response')} already present in an earlier file.")
    if skipped_files:
        print(f"Skipped {len(skipped_files)} {plural(len(skipped_files), 'file')}: {', '.join(skipped_files)}")
    print(f"{len(question_headers)} questions. CoursePrefix matches the division list (BIO-153W-... is BIO).")
    return 0


def read_workbook(path: Path):
    try:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:
        print(f"Could not open {path.name}: {exc}", file=sys.stderr)
        return None
    try:
        raw = find_sheet(workbook, RAW_SHEET)
        if raw is None:
            return None
        mapper = find_sheet(workbook, MAP_SHEET)
        sheet_rows = raw.iter_rows(values_only=True)
        try:
            header = [clean_text(cell) for cell in next(sheet_rows)]
        except StopIteration:
            return None
        index = {name.lower(): position for position, name in enumerate(header) if name}
        if "coursecode" not in index or not any(QUESTION_HEADER.match(name) for name in header if name):
            return None

        questions = read_question_map(mapper) if mapper is not None else {}
        parsed_rows = []
        for values in sheet_rows:
            if values is None or all(cell is None or clean_text(cell) == "" for cell in values):
                continue
            record = row_from_values(header, values, questions, path.name)
            if record.get("CourseCode") or record.get("ResponseUniqueId"):
                parsed_rows.append(record)
        return questions_for_file(parsed_rows, questions, header), parsed_rows
    finally:
        workbook.close()


def find_sheet(workbook, name: str):
    for sheet in workbook.worksheets:
        if sheet.title.replace(" ", "").lower() == name:
            return sheet
    return None


def read_question_map(sheet) -> dict[int, str]:
    mapping = {}
    rows = sheet.iter_rows(values_only=True)
    try:
        next(rows)
    except StopIteration:
        return mapping
    for row in rows:
        if not row or row[0] is None:
            continue
        match = QUESTION_HEADER.match(clean_text(row[0]))
        if not match:
            continue
        text = clean_text(row[1]) if len(row) > 1 else ""
        mapping[int(match.group(1))] = text
    return mapping


def questions_for_file(parsed_rows, questions, header) -> dict[int, str]:
    instructor = ""
    for row in parsed_rows:
        instructor = row.get("InstructorFromTitle") or instructor
        if instructor:
            break
    found = {}
    for name in header:
        if not name:
            continue
        match = QUESTION_HEADER.match(name)
        if not match:
            continue
        number = int(match.group(1))
        text = questions.get(number) or name
        found[number] = canonical_question(text, instructor)
    return found


def row_from_values(header, values, questions, source_name) -> dict:
    by_name = {}
    for position, name in enumerate(header):
        if not name or name.lower() in SKIP_SOURCE_COLUMNS:
            continue
        if position < len(values):
            by_name[name] = cell_value(values[position])
    course_code = by_name.get("CourseCode", "")
    course_title = by_name.get("CourseTitle", "")
    instructor = instructor_from_title(course_title)
    record = {
        "SourceFile": source_name,
        "CoursePrefix": course_prefix(course_code),
        "InstructorFromTitle": instructor,
    }
    for column in IDENTITY_COLUMNS:
        if column in record:
            continue
        record[column] = by_name.get(column, "")
    for name, value in by_name.items():
        match = QUESTION_HEADER.match(name)
        if not match:
            continue
        number = int(match.group(1))
        text = canonical_question(questions.get(number) or name, instructor)
        record[question_column(number, text)] = value
    return record


def question_mismatch(existing: dict[int, str], incoming: dict[int, str], filename: str) -> str:
    conflicts = []
    for number, text in incoming.items():
        previous = existing.get(number)
        if previous and previous != text:
            conflicts.append(f"  Question {number}\n    kept: {previous}\n    {filename}: {text}")
    if not conflicts:
        return ""
    return "Question text does not match across files. Nothing was written.\n" + "\n".join(conflicts)


def default_folder() -> Path:
    script_dir = Path(__file__).resolve().parent
    here = Path.cwd()
    if any(script_dir.glob("*.xlsx")):
        return script_dir
    return here


def plural(count: int, word: str) -> str:
    return word if count == 1 else word + "s"


def question_column(number: int, text: str) -> str:
    label = text or f"Question {number}"
    return f"Q{number:02d} | {label}"


def instructor_from_title(title: str) -> str:
    if " : " not in title:
        return ""
    return title.rsplit(" : ", 1)[-1].strip()


def course_prefix(course_code: str) -> str:
    head = course_code.split("-", 1)[0].strip().upper()
    return re.sub(r"[^A-Z0-9]", "", head)


def canonical_question(text: str, instructor: str) -> str:
    cleaned = clean_text(text)
    if not instructor:
        return cleaned
    match = re.search(r":\s*([^:]+)$", cleaned)
    if not match:
        return cleaned
    tail = match.group(1).strip()
    if tail == instructor or tail in instructor or instructor in tail:
        return cleaned[: match.start()].rstrip()
    return cleaned


def cell_value(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, str):
        return value.replace("\xa0", " ").strip()
    return str(value).strip()


def clean_text(value) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


if __name__ == "__main__":
    raise SystemExit(main())
